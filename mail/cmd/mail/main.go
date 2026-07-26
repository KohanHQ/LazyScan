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

	"github.com/KohanHQ/lazyscan/mail/internal/config"
	"github.com/KohanHQ/lazyscan/mail/internal/consumer"
	"github.com/KohanHQ/lazyscan/mail/internal/mailer"
	"github.com/KohanHQ/lazyscan/mail/internal/processor"
	"github.com/KohanHQ/lazyscan/mail/internal/store"
)

const shutdownTimeout = 10 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "mail:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, nil))
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
		SSL:      cfg.SMTPSSL,
		StartTLS: cfg.SMTPStartTLS,
	})
	if err != nil {
		return err
	}

	handler := processor.New(st, mail, logger)
	cons := consumer.New(rdb, handler, cfg.ClaimIdle, cfg.MaxDeliveries, cfg.Concurrency, logger)
	if err := cons.EnsureGroup(ctx); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newMux(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("mail listening", "addr", srv.Addr)
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
		// nil only on ctx cancel — consumer already drained.
	case <-ctx.Done():
		// Drain the consumer first so closing redis/pool can't race an in-flight
		// XACK or durable write (Run returns only after its batch finishes).
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

// newMux serves the liveness surface only: GET /health → 200. The mail service has no
// sync request path — verification emails flow through the Redis consumer.
func newMux() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	return mux
}
