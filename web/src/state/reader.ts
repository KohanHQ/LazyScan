import type { ReaderChapterDetail, ReaderChapterPage } from "@/api/reader";

type ReaderState = {
  detail: ReaderChapterDetail | null;
  currentPageIndex: number;
  mangaId: string | null;
};

type ReaderListener = (state: ReaderState) => void;

const listeners = new Set<ReaderListener>();

let state: ReaderState = {
  detail: null,
  currentPageIndex: 0,
  mangaId: null,
};

function setState(nextState: ReaderState): void {
  state = nextState;
  for (const listener of listeners) {
    listener(state);
  }
}

export function getReaderState(): ReaderState {
  return state;
}

export function subscribeReader(listener: ReaderListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function loadReaderDetail(
  mangaId: string,
  detail: ReaderChapterDetail,
  startIndex = 0
): void {
  setState({ detail, currentPageIndex: startIndex, mangaId });
}

export function goToPage(index: number): void {
  if (!state.detail) return;
  if (index < 0 || index >= state.detail.pages.length) return;
  setState({ ...state, currentPageIndex: index });
}

export function nextPage(): void {
  goToPage(state.currentPageIndex + 1);
}

export function previousPage(): void {
  goToPage(state.currentPageIndex - 1);
}

export function getCurrentPage(): ReaderChapterPage | null {
  if (!state.detail) return null;
  return state.detail.pages[state.currentPageIndex] ?? null;
}

export function isFirstPage(): boolean {
  return state.currentPageIndex === 0;
}

export function isLastPage(): boolean {
  if (!state.detail) return true;
  return state.currentPageIndex >= state.detail.pages.length - 1;
}

export function getTotalPages(): number {
  return state.detail?.pages.length ?? 0;
}

export function resetReaderState(): void {
  setState({ detail: null, currentPageIndex: 0, mangaId: null });
}
