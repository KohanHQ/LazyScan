package store

import "errors"

// Sentinel domain outcomes — non-retryable by definition: redelivery cannot
// make a deleted row reappear.
var (
	ErrPageNotFound   = errors.New("page not found")
	ErrImportNotFound = errors.New("import not found")
)

// IsRetryable classifies a store error for the contract's failure taxonomy.
// Coarse on purpose: the not-found sentinels are domain outcomes;
// everything else from the database (connection loss, timeouts, transient
// Postgres failures) is retryable — the message stays pending and is
// redelivered or reclaimed.
func IsRetryable(err error) bool {
	if err == nil {
		return false
	}
	return !errors.Is(err, ErrPageNotFound) && !errors.Is(err, ErrImportNotFound)
}
