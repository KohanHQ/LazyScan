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

	"github.com/LazyScan/Herald/internal/config"
	"github.com/LazyScan/Herald/internal/consumer"
	"github.com/LazyScan/Herald/internal/health"
	"github.com/LazyScan/Herald/internal/mailer"
	"github.com/LazyScan/Herald/internal/metrics"
	"github.com/LazyScan/Herald/internal/processor"
	"github.com/LazyScan/Herald/internal/store"
)

const shutdownTimeout = 10 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "herald:", err)
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

	mail, err := mailer.NewSMTP(mailer.SMTPOptions{
		Host:     cfg.SMTPHost,
		Port:     cfg.SMTPPort,
		From:     cfg.SMTPFrom,
		Username: cfg.SMTPUsername,
		Password: cfg.SMTPPassword,
		StartTLS: cfg.SMTPStartTLS,
	})
	if err != nil {
		return err
	}

	m := metrics.New()

	handler := processor.New(st, mail, logger)
	handler.SetObserver(m)
	cons := consumer.New(rdb, handler, cfg.ClaimIdle, cfg.MaxDeliveries, cfg.Concurrency, logger)
	cons.SetStreamObserver(m)
	if err := cons.EnsureGroup(ctx); err != nil {
		return err
	}

	srv := health.NewServer(cfg.Addr, m.Handler())

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("herald listening", "addr", cfg.Addr)
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
		// batch before returning, so once it does there is no in-flight
		// message and closing the Redis client and the pool (deferred) cannot
		// race an XACK or a durable write.
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
