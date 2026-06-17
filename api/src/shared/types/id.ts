export type UUID = string & {
  readonly __brand: "UUID";
};

export type DisplayID = string & {
  readonly __brand: "DisplayID";
};
