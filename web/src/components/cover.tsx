import {
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { cn } from "@/lib/utils";

// Cover image with a letter-placeholder fallback; onError swaps in the placeholder.
// Images fade in on load (.cover-fade in base.css) to soften R2 pop-in.
// `loading` defaults lazy; the carousel passes eager because its off-window
// copies would never enter a scroll viewport for lazy to fire.
export function Cover(props: {
  url: string | null;
  seed: string;
  placeholderClass: string;
  imgClassName?: string;
  loading?: "lazy" | "eager";
}): ReactElement {
  // Track which URL failed so a later, different URL gets a fresh attempt.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const failed = failedUrl !== null && failedUrl === props.url;
  const letter = (props.seed.slice(0, 1) || "?").toUpperCase();

  // A cached image can already be complete before onLoad binds; check before
  // paint. Also resets the fade when the URL changes to a not-yet-loaded one.
  useLayoutEffect(() => {
    setLoaded(imgRef.current?.complete ?? false);
  }, [props.url]);

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
      ref={imgRef}
      src={url}
      alt=""
      className={cn("cover-fade", loaded && "is-loaded", props.imgClassName)}
      loading={props.loading ?? "lazy"}
      onLoad={() => setLoaded(true)}
      onError={() => setFailedUrl(url)}
    />
  );
}
