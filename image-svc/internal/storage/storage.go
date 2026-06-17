// Package storage is Kiln's S3-compatible object client (minio-go): download
// the staged original, upload the converted page. Works against MinIO (local
// compose) and R2 (production) — same adapter contract as the LazyScan API's
// S3CompatibleStorage (api/src/shared/storage/s3.ts).
package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// ErrObjectNotFound marks a missing object — non-retryable per the failure
// taxonomy (original missing after the verification window).
var ErrObjectNotFound = errors.New("object not found")

// Config is the connection profile (config.Storage* values).
type Config struct {
	Endpoint        string // URL with scheme, e.g. http://minio:9000
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	Bucket          string
	ForcePathStyle  bool
}

// Client wraps a bucket-scoped minio client.
type Client struct {
	mc     *minio.Client
	bucket string
}

// Open builds the client from an endpoint URL. minio-go wants host + secure
// flag separately, so the scheme is split off here.
func Open(cfg Config) (*Client, error) {
	u, err := url.Parse(cfg.Endpoint)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("STORAGE_ENDPOINT %q: must be a URL with scheme and host", cfg.Endpoint)
	}
	lookup := minio.BucketLookupDNS
	if cfg.ForcePathStyle {
		lookup = minio.BucketLookupPath
	}
	mc, err := minio.New(u.Host, &minio.Options{
		Creds:        credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure:       u.Scheme == "https",
		Region:       cfg.Region,
		BucketLookup: lookup,
	})
	if err != nil {
		return nil, fmt.Errorf("storage client: %w", err)
	}
	return &Client{mc: mc, bucket: cfg.Bucket}, nil
}

// Download fetches the whole object. A missing key returns ErrObjectNotFound;
// anything else is transient as far as the caller knows (retryable).
func (c *Client) Download(ctx context.Context, key string) ([]byte, error) {
	obj, err := c.mc.GetObject(ctx, c.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("get object %s: %w", key, err)
	}
	defer obj.Close()

	data, err := io.ReadAll(obj)
	if err != nil {
		if minio.ToErrorResponse(err).Code == minio.NoSuchKey {
			return nil, fmt.Errorf("object %s: %w", key, ErrObjectNotFound)
		}
		return nil, fmt.Errorf("read object %s: %w", key, err)
	}
	return data, nil
}

// Upload writes the object with the given content type. Final keys are
// deterministic (read from the page row), so a retried upload overwrites the
// same key — that is the idempotency contract, not an accident. Metadata
// mirrors the API's upload (sourceKey, processedAt).
func (c *Client) Upload(ctx context.Context, key string, data []byte, contentType, sourceKey string) error {
	_, err := c.mc.PutObject(ctx, c.bucket, key, bytes.NewReader(data), int64(len(data)), minio.PutObjectOptions{
		ContentType: contentType,
		UserMetadata: map[string]string{
			"sourceKey":   sourceKey,
			"processedAt": time.Now().UTC().Format(time.RFC3339),
		},
	})
	if err != nil {
		return fmt.Errorf("put object %s: %w", key, err)
	}
	return nil
}
