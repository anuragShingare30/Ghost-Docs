"use client";

import * as Y from "yjs";

export class YjsSync {
  private readonly doc: Y.Doc;
  private readonly yText: Y.Text;
  private applyingRemote = false;

  constructor(initialText = "") {
    this.doc = new Y.Doc();
    this.yText = this.doc.getText("content");
    if (initialText) {
      this.yText.insert(0, initialText);
    }
  }

  getText() {
    return this.yText.toString();
  }

  applyLocalText(nextValue: string) {
    const current = this.getText();
    if (current === nextValue) {
      return null;
    }

    this.doc.transact(() => {
      this.yText.delete(0, this.yText.length);
      this.yText.insert(0, nextValue);
    }, "local");

    return Y.encodeStateAsUpdate(this.doc);
  }

  applyRemoteUpdate(update: Uint8Array) {
    this.applyingRemote = true;
    Y.applyUpdate(this.doc, update, "remote");
    this.applyingRemote = false;
    return this.getText();
  }

  encodeUpdate(update: Uint8Array) {
    return btoa(String.fromCharCode(...update));
  }

  decodeUpdate(encoded: string) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  isApplyingRemote() {
    return this.applyingRemote;
  }
}
