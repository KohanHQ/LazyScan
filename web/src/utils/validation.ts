// Numeric-field backstop for the noValidate chapter forms: chapter number /
// volume must be non-negative, sort order a whole number. Empty raw values are
// optional and pass (the caller decides how to send them).
export function validateChapterNumbers(
  numberRaw: string,
  volumeRaw: string,
  sortRaw: string
): string | null {
  if (numberRaw && !(Number(numberRaw) >= 0)) {
    return "Chapter number must be zero or greater.";
  }
  if (volumeRaw && !(Number(volumeRaw) >= 0)) {
    return "Volume must be zero or greater.";
  }
  if (sortRaw && !Number.isInteger(Number(sortRaw))) {
    return "Sort order must be a whole number.";
  }
  return null;
}
