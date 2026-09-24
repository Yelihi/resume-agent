/** Server file identity; the infrastructure supplies its authenticated download URL. */
export type StoredFile = { fileId: string; downloadUrl: string };
export type OriginalFile = Blob | StoredFile;
