export type StorageWriteResult = {
  ddocId: string;
  syncStatus?: "pending" | "synced" | "failed";
  localVersion?: number;
  onchainVersion?: number;
  link?: string;
  updatedAt?: string;
};

export type StorageReadResult = {
  ddocId: string;
  title?: string;
  content?: string;
  syncStatus?: "pending" | "synced" | "failed";
  localVersion?: number;
  onchainVersion?: number;
  link?: string;
  updatedAt?: string;
};

export interface StorageAdapter {
  createDoc(title: string, content: string): Promise<StorageWriteResult>;
  updateDoc(ddocId: string, content: string, title?: string): Promise<StorageWriteResult>;
  getDoc(ddocId: string): Promise<StorageReadResult>;
  deleteDoc(ddocId: string): Promise<void>;
}
