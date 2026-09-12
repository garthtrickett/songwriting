import type { Action } from "../../generated/desktop/Action.ts";
import type { Snapshot } from "./wire.ts";

/// A workbench panel reads projected state and proposes named actions. It never
/// mutates the snapshot: Rust accepts or rejects every edit, and the next
/// snapshot is the only evidence that something changed.
export type Edit = (action: Action, label: string) => void;
export interface Workbench {
  s: Snapshot;
  edit: Edit;
  busy: boolean;
  /// Panels keep drafts and validation errors in their own closure. A snapshot
  /// only arrives when Rust accepts something, so local state needs its own
  /// repaint or a typed value would not show until the next accepted edit.
  repaint: () => void;
}
/// Fresh entity IDs are minted by the view but only ever *proposed*; Rust
/// rejects any ID that already exists, so a collision cannot corrupt a song.
export const fresh = () => crypto.randomUUID();
