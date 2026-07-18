import { useState, type ReactElement } from "react";

// Cover image with a letter-placeholder fallback; onError swaps in the placeholder.
export function Cover(props: {
  url: string | null;
  seed: string;
  placeholderClass: string;
  imgClassName?: string;
}): ReactElement {
  // Track which URL failed so a later, different URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl !== null && failedUrl === props.url;
  const letter = (props.seed.slice(0, 1) || "?").toUpperCase();
  if (!props.url || failed) {
    return (
      <div className={props.placeholderClass} aria-hidden="true">
        {letter}
      </div>
    );
  }
  const url = props.url;
  return (
    <img
      src={url}
      alt=""
      className={props.imgClassName}
      loading="lazy"
      onError={() => setFailedUrl(url)}
    />
  );
}
