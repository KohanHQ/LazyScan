// Package convert is the image service's pipeline: the reader profile from
// known-constraints.md (EXIF auto-rotate, fit inside 1080x1920, never
// enlarge, WebP q88, input <= 10MB) on libvips via govips — the same engine
// the LazyScan sharp pipeline wraps. Output is visually equivalent to sharp;
// pixel-exactness is not promised (different libvips builds), the
// dimension/format/quality rules are.
package convert

import (
	"errors"
	"fmt"
	"log/slog"

	"github.com/davidbyttow/govips/v2/vips"
)

// ErrUnprocessable marks input that can never convert (unsupported format,
// over the size limit, corrupt) — non-retryable per the failure taxonomy.
var ErrUnprocessable = errors.New("unprocessable image")

const (
	// MaxInputBytes mirrors the API's MAX_IMAGE_UPLOAD_BYTES (10MB).
	MaxInputBytes = 10 * 1024 * 1024

	maxWidth  = 1080
	maxHeight = 1920
	quality   = 88
)

// Options tunes the reader profile per call: fit-inside bounds and WebP
// quality. The page consumer uses Default(); the HTTP path overrides them.
type Options struct {
	MaxWidth  int
	MaxHeight int
	Quality   int
}

// Default is the chapter-page reader profile: fit inside 1080x1920, WebP q88.
func Default() Options {
	return Options{MaxWidth: maxWidth, MaxHeight: maxHeight, Quality: quality}
}

// Startup initializes libvips and routes its log lines into slog. Call once
// from main before any Convert; pair with Shutdown.
func Startup(log *slog.Logger) error {
	vips.LoggingSettings(func(domain string, level vips.LogLevel, msg string) {
		log.Warn("vips", "domain", domain, "message", msg)
	}, vips.LogLevelWarning)
	if err := vips.Startup(nil); err != nil {
		return fmt.Errorf("vips startup: %w", err)
	}
	return nil
}

// Shutdown releases libvips resources.
func Shutdown() {
	vips.Shutdown()
}

// Result is the converted page.
type Result struct {
	WebP   []byte
	Width  int
	Height int
}

// Converter runs the reader profile. Stateless; methods exist so the
// processor can depend on a narrow interface.
type Converter struct{}

// New assembles a Converter.
func New() *Converter {
	return &Converter{}
}

// Convert validates and converts one original image against opt. Every error
// wraps ErrUnprocessable: for a given input the pipeline is deterministic, so
// retrying cannot change the outcome (failure taxonomy: non-retryable).
func (c *Converter) Convert(input []byte, opt Options) (Result, error) {
	if len(input) > MaxInputBytes {
		return Result{}, fmt.Errorf("%w: input %d bytes exceeds %d", ErrUnprocessable, len(input), MaxInputBytes)
	}

	switch vips.DetermineImageType(input) {
	case vips.ImageTypeJPEG, vips.ImageTypePNG, vips.ImageTypeWEBP:
	default:
		return Result{}, fmt.Errorf("%w: not a JPEG, PNG, or WebP", ErrUnprocessable)
	}

	img, err := vips.NewImageFromBuffer(input)
	if err != nil {
		return Result{}, fmt.Errorf("%w: decode: %v", ErrUnprocessable, err)
	}
	defer img.Close()

	if err := img.AutoRotate(); err != nil {
		return Result{}, fmt.Errorf("%w: auto-rotate: %v", ErrUnprocessable, err)
	}

	// fit: inside, withoutEnlargement — one uniform scale preserves aspect;
	// scale >= 1 means the image already fits and stays untouched.
	scale := min(
		float64(opt.MaxWidth)/float64(img.Width()),
		float64(opt.MaxHeight)/float64(img.Height()),
	)
	if scale < 1 {
		if err := img.Resize(scale, vips.KernelLanczos3); err != nil {
			return Result{}, fmt.Errorf("%w: resize: %v", ErrUnprocessable, err)
		}
	}

	params := vips.NewWebpExportParams()
	params.Quality = opt.Quality
	params.StripMetadata = true
	webp, meta, err := img.ExportWebp(params)
	if err != nil {
		return Result{}, fmt.Errorf("%w: encode webp: %v", ErrUnprocessable, err)
	}
	return Result{WebP: webp, Width: meta.Width, Height: meta.Height}, nil
}
