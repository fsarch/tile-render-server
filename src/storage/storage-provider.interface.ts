// A storage backend for either `storage.data` (the pmtiles archive) or
// `storage.cache` (rendered SVG tiles) - implementations resolve every path relative
// to their own configured root (a local directory, or an S3 bucket/prefix), so callers
// never need to know or care which backend is actually in use.
export interface IStorageProvider {
  /** Read an entire small file (e.g. one cached SVG tile). */
  readFile(path: string): Promise<Buffer>;

  /** Write an entire small file (e.g. one cached SVG tile). */
  writeFile(path: string, data: Buffer): Promise<void>;

  /**
   * Read `length` bytes starting at `offset`, without loading the whole file.
   * The pmtiles archive this backs `storage.data` for is typically hundreds of MB to
   * several GB - PMTiles itself is designed around exactly this kind of random-access
   * range read (its own directory structure + tile lookups), never a whole-file read.
   */
  readRange(path: string, offset: number, length: number): Promise<Buffer>;

  /** Check whether a file exists. */
  exists(path: string): Promise<boolean>;

  /** Create a directory (recursively, if requested). No-op for backends without a
   *  real directory concept (e.g. S3). */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Delete a file. */
  deleteFile(path: string): Promise<void>;
}
