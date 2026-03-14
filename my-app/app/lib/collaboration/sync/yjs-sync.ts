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

    let prefixLength = 0;
    const maxPrefix = Math.min(current.length, nextValue.length);
    while (
      prefixLength < maxPrefix &&
      current[prefixLength] === nextValue[prefixLength]
    ) {
      prefixLength += 1;
    }

    let currentSuffixLength = current.length;
    let nextSuffixLength = nextValue.length;
    while (
      currentSuffixLength > prefixLength &&
      nextSuffixLength > prefixLength &&
      current[currentSuffixLength - 1] === nextValue[nextSuffixLength - 1]
    ) {
      currentSuffixLength -= 1;
      nextSuffixLength -= 1;
    }

    const deleteLength = currentSuffixLength - prefixLength;
    const insertText = nextValue.slice(prefixLength, nextSuffixLength);

    this.doc.transact(() => {
      if (deleteLength > 0) {
        this.yText.delete(prefixLength, deleteLength);
      }

      if (insertText.length > 0) {
        this.yText.insert(prefixLength, insertText);
      }
    }, "local");

    return Y.encodeStateAsUpdate(this.doc);
  }

  applyRemoteUpdate(update: Uint8Array) {
    this.applyingRemote = true;
    Y.applyUpdate(this.doc, update, "remote");
    this.applyingRemote = false;
    return this.getText();
  }

  encodeFullState() {
    return Y.encodeStateAsUpdate(this.doc);
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
