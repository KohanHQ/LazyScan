// Package consumer is the image service's Redis Streams transport: consumer-group reads,
// pending-entry reclaim, poison threshold detection, and acks. All policy
// decisions live in the processor; this package only moves messages and obeys
// the returned Outcome (event-contract.md §Delivery semantics).
package consumer

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/KohanHQ/lazyscan/image/internal/processor"
)

const (
	// Stream topology (binding contract).
	Stream = "events:chapter-page"
	Group  = "image"

	// streamField is the single wire-format field holding the envelope JSON.
	streamField = "event"

	readBlock       = 5 * time.Second
	readCount       = 10
	reclaimInterval = 30 * time.Second
	reclaimCount    = 100
	errorBackoff    = time.Second
)

// Consumer runs the stream read/claim/ack lifecycle.
type Consumer struct {
	rdb           *redis.Client
	handler       *processor.Handler
	name          string
	claimIdle     time.Duration
	maxDeliveries int
	concurrency   int
	log           *slog.Logger
}

// New assembles a Consumer. The consumer name is stable enough to find a
// crashed instance's pending entries, unique enough to run replicas.
func New(rdb *redis.Client, h *processor.Handler, claimIdle time.Duration, maxDeliveries, concurrency int, log *slog.Logger) *Consumer {
	hostname, err := os.Hostname()
	if err != nil {
		hostname = "unknown"
	}
	return &Consumer{
		rdb:           rdb,
		handler:       h,
		name:          fmt.Sprintf("image-%s-%d", hostname, os.Getpid()),
		claimIdle:     claimIdle,
		maxDeliveries: maxDeliveries,
		concurrency:   concurrency,
		log:           log,
	}
}

// EnsureGroup creates the consumer group idempotently. Start "0" so a group
// created late still sees earlier entries; BUSYGROUP means it already exists.
func (c *Consumer) EnsureGroup(ctx context.Context) error {
	err := c.rdb.XGroupCreateMkStream(ctx, Stream, Group, "0").Err()
	if err != nil && !strings.Contains(err.Error(), "BUSYGROUP") {
		return fmt.Errorf("create consumer group: %w", err)
	}
	return nil
}

// Run reads and handles messages until ctx is cancelled. Entries within one
// read/claim batch are handled concurrently (IMAGE_SVC_CONSUMER_CONCURRENCY);
// Run only returns with zero entries in flight.
func (c *Consumer) Run(ctx context.Context) error {
	c.log.Info("consumer started",
		"stream", Stream, "group", Group, "consumer", c.name,
		"claimIdle", c.claimIdle, "maxDeliveries", c.maxDeliveries,
		"concurrency", c.concurrency,
	)
	var lastReclaim time.Time
	for {
		if ctx.Err() != nil {
			c.log.Info("consumer stopped", "consumer", c.name)
			return nil
		}
		if time.Since(lastReclaim) >= reclaimInterval {
			c.reclaimOnce(ctx)
			lastReclaim = time.Now()
		}
		c.readOnce(ctx)
	}
}

// readOnce blocks up to readBlock for new entries and handles them.
func (c *Consumer) readOnce(ctx context.Context) {
	res, err := c.rdb.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    Group,
		Consumer: c.name,
		Streams:  []string{Stream, ">"},
		Count:    readCount,
		Block:    readBlock,
	}).Result()
	switch {
	case errors.Is(err, redis.Nil):
		return // BLOCK window elapsed with nothing new — normal
	case errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded):
		return // shutdown; Run's ctx check exits the loop
	case err != nil:
		c.log.Warn("read failed, backing off", "error", err)
		c.sleep(ctx, errorBackoff)
		return
	}
	for _, stream := range res {
		c.dispatchBatch(ctx, stream.Messages, nil)
	}
}

// reclaimOnce claims entries pending longer than claimIdle (crashed or stuck
// consumers) and routes those at the delivery threshold to the poison path.
// One batch per tick; the next tick continues a larger backlog.
func (c *Consumer) reclaimOnce(ctx context.Context) {
	msgs, _, err := c.rdb.XAutoClaim(ctx, &redis.XAutoClaimArgs{
		Stream:   Stream,
		Group:    Group,
		Consumer: c.name,
		MinIdle:  c.claimIdle,
		Start:    "0",
		Count:    reclaimCount,
	}).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			c.log.Warn("reclaim failed", "error", err)
		}
		return
	}
	if len(msgs) == 0 {
		return
	}

	// XAUTOCLAIM does not return delivery counts; fetch them for our pending
	// entries. The claim above made these entries ours, and it also
	// incremented their counters — so >= maxDeliveries poisons on exactly the
	// Nth delivery.
	counts := make(map[string]int64, len(msgs))
	pend, err := c.rdb.XPendingExt(ctx, &redis.XPendingExtArgs{
		Stream:   Stream,
		Group:    Group,
		Consumer: c.name,
		Start:    "-",
		End:      "+",
		Count:    int64(len(msgs) + reclaimCount), // generous: our pending list may hold more than this batch
	}).Result()
	if err != nil {
		c.log.Warn("pending lookup failed, handling without poison check", "error", err)
	} else {
		for _, p := range pend {
			counts[p.ID] = p.RetryCount
		}
	}

	c.log.Info("reclaimed pending entries", "count", len(msgs))
	c.dispatchBatch(ctx, msgs, counts)
}

// dispatchBatch handles one read/claim batch, at most concurrency entries at
// a time, and waits for the whole batch — Run never returns with an entry in
// flight (main's drain-then-close shutdown ordering depends on that). The
// batch waits for its slowest page; acceptable head-of-line cost at the small
// defaults (concurrency 2, batches of 10). A nil counts map means deliveries
// are unknown — dispatch treats 0 as "never poison".
func (c *Consumer) dispatchBatch(ctx context.Context, msgs []redis.XMessage, counts map[string]int64) {
	if c.concurrency <= 1 {
		for _, msg := range msgs {
			c.dispatch(ctx, msg, counts[msg.ID])
		}
		return
	}
	sem := make(chan struct{}, c.concurrency)
	var wg sync.WaitGroup
	for _, msg := range msgs {
		sem <- struct{}{}
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			c.dispatch(ctx, msg, counts[msg.ID])
		}()
	}
	wg.Wait()
}

// dispatch routes one entry through the handler and acks only on OutcomeAck.
// deliveries == 0 means unknown (fresh read or failed pending lookup) — never
// poison on unknown.
func (c *Consumer) dispatch(ctx context.Context, msg redis.XMessage, deliveries int64) {
	raw, ok := msg.Values[streamField].(string)
	if !ok {
		// Missing `event` field is poison by contract; below the threshold it
		// stays pending so the reclaim path can count deliveries.
		if deliveries >= int64(c.maxDeliveries) {
			c.finish(ctx, msg.ID, func() (processor.Outcome, error) {
				return c.handler.HandlePoison(ctx, fmt.Sprintf("%v", msg.Values), deliveries)
			})
			return
		}
		c.log.Warn("entry missing event field, leaving pending", "id", msg.ID, "deliveries", deliveries)
		return
	}

	if deliveries >= int64(c.maxDeliveries) {
		c.finish(ctx, msg.ID, func() (processor.Outcome, error) {
			return c.handler.HandlePoison(ctx, raw, deliveries)
		})
		return
	}
	c.finish(ctx, msg.ID, func() (processor.Outcome, error) {
		return c.handler.Handle(ctx, raw)
	})
}

// finish runs a handler call and acks if — and only if — it reports a durable
// outcome. Retryable outcomes leave the entry pending for redelivery/reclaim.
func (c *Consumer) finish(ctx context.Context, id string, handle func() (processor.Outcome, error)) {
	outcome, err := handle()
	if err != nil {
		c.log.Warn("handling failed, leaving pending", "id", id, "error", err)
	}
	if outcome != processor.OutcomeAck {
		return
	}
	if err := c.rdb.XAck(ctx, Stream, Group, id).Err(); err != nil {
		// Durable outcome exists; a lost ack just means redelivery hits the
		// dedup check and no-ops — designed behavior, not an edge case.
		c.log.Warn("ack failed; redelivery will dedup", "id", id, "error", err)
	}
}

// sleep waits without outliving ctx.
func (c *Consumer) sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}
