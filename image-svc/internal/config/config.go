// Package config parses Kiln's environment variables: pipeline connections
// (Postgres, Redis), consumer tunables, and the S3-compatible storage
// profile (see docs/wiki/running.md).
package config

import (
	"fmt"
	"strconv"
	"time"
)

// Config is the resolved Kiln runtime configuration.
type Config struct {
	Addr      string
	LogFormat string // "text" or "json"

	DatabaseURL string
	RedisURL    string

	ClaimIdle     time.Duration // XAUTOCLAIM min-idle before reclaiming a pending entry
	MaxDeliveries int           // delivery count at which a message is poisoned
	Concurrency   int           // max entries handled concurrently per batch

	// S3-compatible storage. Names and values match the LazyScan API's
	// STORAGE_* env so compose can share them (running.md).
	StorageEndpoint        string
	StorageRegion          string
	StorageAccessKeyID     string
	StorageSecretAccessKey string
	StorageBucket          string
	StoragePublicDomain    string // browser-reachable base URL; image_url = domain + "/" + storage_key
	StorageForcePathStyle  bool
}

const (
	defaultAddr          = ":8085"
	defaultLogFormat     = "text"
	defaultClaimIdle     = 60 * time.Second
	defaultMaxDeliveries = 5
	defaultConcurrency   = 2 // parity with the BullMQ worker Kiln replaced
	defaultStorageRegion = "us-east-1"
)

// Load reads configuration through getenv (os.Getenv in production, a stub in
// tests). Empty values fall back to defaults; DATABASE_URL and REDIS_URL have
// no defaults and must be set.
func Load(getenv func(string) string) (*Config, error) {
	cfg := &Config{
		Addr:        envOr(getenv, "KILN_ADDR", defaultAddr),
		LogFormat:   envOr(getenv, "KILN_LOG_FORMAT", defaultLogFormat),
		DatabaseURL: getenv("DATABASE_URL"),
		RedisURL:    getenv("REDIS_URL"),
	}

	if cfg.LogFormat != "text" && cfg.LogFormat != "json" {
		return nil, fmt.Errorf("KILN_LOG_FORMAT %q: must be text or json", cfg.LogFormat)
	}
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL: required")
	}
	if cfg.RedisURL == "" {
		return nil, fmt.Errorf("REDIS_URL: required")
	}

	claimIdle := envOr(getenv, "KILN_CONSUMER_CLAIM_IDLE", defaultClaimIdle.String())
	d, err := time.ParseDuration(claimIdle)
	if err != nil || d <= 0 {
		return nil, fmt.Errorf("KILN_CONSUMER_CLAIM_IDLE %q: must be a positive duration", claimIdle)
	}
	cfg.ClaimIdle = d

	maxDeliveries := envOr(getenv, "KILN_CONSUMER_MAX_DELIVERIES", strconv.Itoa(defaultMaxDeliveries))
	n, err := strconv.Atoi(maxDeliveries)
	if err != nil || n < 1 {
		return nil, fmt.Errorf("KILN_CONSUMER_MAX_DELIVERIES %q: must be a positive integer", maxDeliveries)
	}
	cfg.MaxDeliveries = n

	concurrency := envOr(getenv, "KILN_CONSUMER_CONCURRENCY", strconv.Itoa(defaultConcurrency))
	w, err := strconv.Atoi(concurrency)
	if err != nil || w < 1 {
		return nil, fmt.Errorf("KILN_CONSUMER_CONCURRENCY %q: must be a positive integer", concurrency)
	}
	cfg.Concurrency = w

	cfg.StorageEndpoint = getenv("STORAGE_ENDPOINT")
	cfg.StorageRegion = envOr(getenv, "STORAGE_REGION", defaultStorageRegion)
	cfg.StorageAccessKeyID = getenv("STORAGE_ACCESS_KEY_ID")
	cfg.StorageSecretAccessKey = getenv("STORAGE_SECRET_ACCESS_KEY")
	cfg.StorageBucket = getenv("STORAGE_BUCKET")
	cfg.StoragePublicDomain = getenv("STORAGE_PUBLIC_DOMAIN")
	for _, required := range []struct{ name, value string }{
		{"STORAGE_ENDPOINT", cfg.StorageEndpoint},
		{"STORAGE_ACCESS_KEY_ID", cfg.StorageAccessKeyID},
		{"STORAGE_SECRET_ACCESS_KEY", cfg.StorageSecretAccessKey},
		{"STORAGE_BUCKET", cfg.StorageBucket},
		{"STORAGE_PUBLIC_DOMAIN", cfg.StoragePublicDomain},
	} {
		if required.value == "" {
			return nil, fmt.Errorf("%s: required", required.name)
		}
	}

	pathStyle := envOr(getenv, "STORAGE_FORCE_PATH_STYLE", "true")
	b, err := strconv.ParseBool(pathStyle)
	if err != nil {
		return nil, fmt.Errorf("STORAGE_FORCE_PATH_STYLE %q: must be a boolean", pathStyle)
	}
	cfg.StorageForcePathStyle = b

	return cfg, nil
}

func envOr(getenv func(string) string, key, def string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return def
}
