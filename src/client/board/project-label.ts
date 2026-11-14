/**
 * Workspace (= project) display naming, shared by the board toolbar, the card
 * header and the project grouping. One implementation so a card can never show
 * a different project label than the group header above it.
 *
 * @module dsh-taskboard/client/board/project-label
 */

/** Minimal workspace shape the naming rules need. */
export interface WorkspaceNaming {
  id: string
  title?: string
  path?: string
}

/**
 * Resolve the display name of a workspace: explicit title, else the last path
 * segment, else a short id prefix, else the unassigned label.
 * @param workspaceId - the task's workspace id (undefined = unassigned).
 * @param workspaces - the loaded workspace registry.
 * @param unassignedLabel - localized label for tasks without a workspace.
 */
export function resolveWorkspaceName(
  workspaceId: string | undefined,
  workspaces: ReadonlyArray<WorkspaceNaming>,
  unassignedLabel: string,
): string {
  if (!workspaceId) return unassignedLabel
  const ws = workspaces.find(w => w.id === workspaceId)
  if (ws?.title && ws.title.trim().length > 0) return ws.title.trim()
  if (ws?.path && ws.path.trim().length > 0) {
    const trimmed = ws.path.trim().replace(/[/\\]+$/, '')
    const base = trimmed.split(/[/\\]/).filter(Boolean).pop()
    return base || trimmed
  }
  return workspaceId.slice(0, 8)
}
