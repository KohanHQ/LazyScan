package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/KohanHQ/lazyscan/image/internal/config"
	"github.com/KohanHQ/lazyscan/image/internal/consumer"
	"github.com/KohanHQ/lazyscan/image/internal/convert"
	"github.com/KohanHQ/lazyscan/image/internal/processor"
	"github.com/KohanHQ/lazyscan/image/internal/storage"
	"github.com/KohanHQ/lazyscan/image/internal/store"
)

const shutdownTimeout = 10 * time.Second

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "image:", err)
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
	conv := convert.New()

	handler := processor.New(st, objects, conv, cfg.StoragePublicDomain, logger)
	cons := consumer.New(rdb, handler, cfg.ClaimIdle, cfg.MaxDeliveries, cfg.Concurrency, logger)
	if err := cons.EnsureGroup(ctx); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           newMux(conv, logger),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("image listening", "addr", srv.Addr)
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

// newMux serves the sync surface: POST /convert (avatars/covers) and
// GET /health. Chapter pages flow through the Redis consumer, not here.
func newMux(conv *convert.Converter, log *slog.Logger) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /convert", convertHandler(conv, log))
	return mux
}

type convertResponse struct {
	WebP   string `json:"webp"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

// convertHandler converts one raw image body to WebP. ?w=&h=&q= override the
// page profile; bad override → 400, unprocessable image → 422.
func convertHandler(conv *convert.Converter, log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, convert.MaxInputBytes))
		if err != nil {
			http.Error(w, "read body", http.StatusBadRequest)
			return
		}

		opt := convert.Default()
		q := r.URL.Query()
		if opt.MaxWidth, err = positiveOr(q.Get("w"), opt.MaxWidth); err != nil {
			http.Error(w, "w: must be a positive integer", http.StatusBadRequest)
			return
		}
		if opt.MaxHeight, err = positiveOr(q.Get("h"), opt.MaxHeight); err != nil {
			http.Error(w, "h: must be a positive integer", http.StatusBadRequest)
			return
		}
		if opt.Quality, err = qualityOr(q.Get("q"), opt.Quality); err != nil {
			http.Error(w, "q: must be an integer in 1..100", http.StatusBadRequest)
			return
		}

		out, err := conv.Convert(body, opt)
		if err != nil {
			if errors.Is(err, convert.ErrUnprocessable) {
				http.Error(w, err.Error(), http.StatusUnprocessableEntity)
				return
			}
			log.Error("convert failed", "error", err)
			http.Error(w, "convert", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(convertResponse{
			WebP:   base64.StdEncoding.EncodeToString(out.WebP),
			Width:  out.Width,
			Height: out.Height,
		}); err != nil {
			log.Error("encode response", "error", err)
		}
	}
}

// positiveOr parses a positive-integer override; absent → def, invalid → error.
func positiveOr(raw string, def int) (int, error) {
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 0, fmt.Errorf("not a positive integer: %q", raw)
	}
	return n, nil
}

// qualityOr parses a WebP quality override in 1..100; absent → def.
func qualityOr(raw string, def int) (int, error) {
	if raw == "" {
		return def, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 || n > 100 {
		return 0, fmt.Errorf("not in 1..100: %q", raw)
	}
	return n, nil
}
