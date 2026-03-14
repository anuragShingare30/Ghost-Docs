import "server-only";

import {
  fileverseCreateDocument,
  fileverseDeleteDocument,
  fileverseGetDocument,
  fileverseUpdateDocument,
} from "../fileverse/fileverse-client";
import { StorageAdapter } from "./storage-adapter";

export class FileverseAdapter implements StorageAdapter {
  async createDoc(title: string, content: string) {
    const created = await fileverseCreateDocument({ title, content });
    return {
      ddocId: created.ddocId,
      syncStatus: created.syncStatus,
      localVersion: created.localVersion,
      onchainVersion: created.onchainVersion,
      link: created.link,
      updatedAt: created.updatedAt,
    };
  }

  async updateDoc(ddocId: string, content: string, title?: string) {
    const updated = await fileverseUpdateDocument({ ddocId, content, title });
    const normalized = "data" in updated ? updated.data : updated;

    return {
      ddocId: normalized.ddocId,
      syncStatus: normalized.syncStatus,
      localVersion: normalized.localVersion,
      onchainVersion: normalized.onchainVersion,
      link: normalized.link,
      updatedAt: normalized.updatedAt,
    };
  }

  async getDoc(ddocId: string) {
    const doc = await fileverseGetDocument(ddocId);
    return {
      ddocId: doc.ddocId,
      title: doc.title,
      content: doc.content,
      syncStatus: doc.syncStatus,
      localVersion: doc.localVersion,
      onchainVersion: doc.onchainVersion,
      link: doc.link,
      updatedAt: doc.updatedAt,
    };
  }

  async deleteDoc(ddocId: string) {
    await fileverseDeleteDocument(ddocId);
  }
}
