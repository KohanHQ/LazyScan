package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/LazyScan/Kiln/internal/config"
	"github.com/LazyScan/Kiln/internal/consumer"
	"github.com/LazyScan/Kiln/internal/convert"
	"github.com/LazyScan/Kiln/internal/health"
	"github.com/LazyScan/Kiln/internal/metrics"
	"github.com/LazyScan/Kiln/internal/processor"
	"github.com/LazyScan/Kiln/internal/storage"
	"github.com/LazyScan/Kiln/internal/store"
)

const shutdownTimeout = 10 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "kiln:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}

	logger := newLogger(cfg.LogFormat)
	slog.SetDefault(logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer st.Close()

	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		return fmt.Errorf("REDIS_URL: %w", err)
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("ping redis: %w", err)
	}

	objects, err := storage.Open(storage.Config{
		Endpoint:        cfg.StorageEndpoint,
		Region:          cfg.StorageRegion,
		AccessKeyID:     cfg.StorageAccessKeyID,
		SecretAccessKey: cfg.StorageSecretAccessKey,
		Bucket:          cfg.StorageBucket,
		ForcePathStyle:  cfg.StorageForcePathStyle,
	})
	if err != nil {
		return err
	}

	if err := convert.Startup(logger); err != nil {
		return err
	}
	defer convert.Shutdown()

	m := metrics.New()

	handler := processor.New(st, objects, convert.New(), cfg.StoragePublicDomain, logger)
	handler.SetObserver(m)
	cons := consumer.New(rdb, handler, cfg.ClaimIdle, cfg.MaxDeliveries, cfg.Concurrency, logger)
	cons.SetStreamObserver(m)
	if err := cons.EnsureGroup(ctx); err != nil {
		return err
	}

	srv := health.NewServer(cfg.Addr, m.Handler())

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("kiln listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serveErr <- err
		}
	}()

	consumerErr := make(chan error, 1)
	go func() {
		consumerErr <- cons.Run(ctx)
	}()

	select {
	case err := <-serveErr:
		return fmt.Errorf("serve: %w", err)
	case err := <-consumerErr:
		if err != nil {
			return fmt.Errorf("consumer: %w", err)
		}
		// nil only happens on ctx cancel — consumer already drained.
	case <-ctx.Done():
		// Drain the consumer before anything else: Run waits for its current
		// batch before returning, so once it does there
		// is no in-flight message and closing the Redis client and the pool
		// (deferred) cannot race an XACK or a durable write.
		select {
		case <-consumerErr:
		case <-time.After(shutdownTimeout):
			logger.Warn("consumer did not stop in time")
		}
	}

	logger.Info("shutting down", "timeout", shutdownTimeout)

	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return fmt.Errorf("shutdown: %w", err)
	}
	logger.Info("shutdown complete")
	return nil
}

func newLogger(format string) *slog.Logger {
	if format == "json" {
		return slog.New(slog.NewJSONHandler(os.Stdout, nil))
	}
	return slog.New(slog.NewTextHandler(os.Stdout, nil))
}
