import { db } from "../db";
import { tripNotes, users } from "@shared/schema";
import { eq, and, desc, isNull, sql, ilike } from "drizzle-orm";

// Roles that can see internal notes
const INTERNAL_VISIBLE_ROLES = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "COMPANY_ADMIN",
  "DISPATCH",
  "DRIVER",
]);

const VALID_NOTE_TYPES = [
  "general",
  "medical",
  "dispatch",
  "driver",
  "billing",
  "patient_request",
] as const;

export type NoteType = (typeof VALID_NOTE_TYPES)[number];

export async function addNote(
  tripId: number,
  companyId: number,
  authorId: number,
  authorRole: string,
  noteType: string,
  content: string,
  isInternal: boolean = false
) {
  if (!VALID_NOTE_TYPES.includes(noteType as NoteType)) {
    throw new Error(`Invalid note type: ${noteType}`);
  }
  if (!content || content.trim().length === 0) {
    throw new Error("Note content cannot be empty");
  }

  const [note] = await db
    .insert(tripNotes)
    .values({
      tripId,
      companyId,
      authorId,
      authorRole,
      noteType,
      content: content.trim(),
      isInternal,
    })
    .returning();

  return note;
}

export async function editNote(noteId: number, authorId: number, content: string) {
  if (!content || content.trim().length === 0) {
    throw new Error("Note content cannot be empty");
  }

  const [existing] = await db
    .select()
    .from(tripNotes)
    .where(and(eq(tripNotes.id, noteId), isNull(tripNotes.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new Error("Note not found");
  }
  if (existing.authorId !== authorId) {
    throw new Error("Only the author can edit this note");
  }

  const [updated] = await db
    .update(tripNotes)
    .set({ content: content.trim(), editedAt: new Date() })
    .where(eq(tripNotes.id, noteId))
    .returning();

  return updated;
}

export async function deleteNote(noteId: number, authorId: number) {
  const [existing] = await db
    .select()
    .from(tripNotes)
    .where(and(eq(tripNotes.id, noteId), isNull(tripNotes.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new Error("Note not found");
  }
  if (existing.authorId !== authorId) {
    throw new Error("Only the author can delete this note");
  }

  const [deleted] = await db
    .update(tripNotes)
    .set({ deletedAt: new Date() })
    .where(eq(tripNotes.id, noteId))
    .returning();

  return deleted;
}

export async function pinNote(noteId: number) {
  const [existing] = await db
    .select()
    .from(tripNotes)
    .where(and(eq(tripNotes.id, noteId), isNull(tripNotes.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new Error("Note not found");
  }

  const [updated] = await db
    .update(tripNotes)
    .set({ isPinned: !existing.isPinned })
    .where(eq(tripNotes.id, noteId))
    .returning();

  return updated;
}

export async function getNotes(tripId: number, viewerRole: string) {
  const canSeeInternal = INTERNAL_VISIBLE_ROLES.has(viewerRole);

  const conditions = [eq(tripNotes.tripId, tripId), isNull(tripNotes.deletedAt)];
  if (!canSeeInternal) {
    conditions.push(eq(tripNotes.isInternal, false));
  }

  const notes = await db
    .select({
      id: tripNotes.id,
      tripId: tripNotes.tripId,
      companyId: tripNotes.companyId,
      authorId: tripNotes.authorId,
      authorRole: tripNotes.authorRole,
      noteType: tripNotes.noteType,
      content: tripNotes.content,
      isInternal: tripNotes.isInternal,
      isPinned: tripNotes.isPinned,
      editedAt: tripNotes.editedAt,
      createdAt: tripNotes.createdAt,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
    })
    .from(tripNotes)
    .leftJoin(users, eq(tripNotes.authorId, users.id))
    .where(and(...conditions))
    .orderBy(desc(tripNotes.isPinned), desc(tripNotes.createdAt));

  return notes;
}

export async function searchNotes(companyId: number, query: string) {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const notes = await db
    .select({
      id: tripNotes.id,
      tripId: tripNotes.tripId,
      noteType: tripNotes.noteType,
      content: tripNotes.content,
      authorRole: tripNotes.authorRole,
      createdAt: tripNotes.createdAt,
      authorFirstName: users.firstName,
      authorLastName: users.lastName,
    })
    .from(tripNotes)
    .leftJoin(users, eq(tripNotes.authorId, users.id))
    .where(
      and(
        eq(tripNotes.companyId, companyId),
        isNull(tripNotes.deletedAt),
        ilike(tripNotes.content, `%${query.trim()}%`)
      )
    )
    .orderBy(desc(tripNotes.createdAt))
    .limit(50);

  return notes;
}
