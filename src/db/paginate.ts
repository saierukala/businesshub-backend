// Standard list response: { items, page, pageSize, total, totalPages }.
export type Page<T> = { items: T[]; page: number; pageSize: number; total: number; totalPages: number };

export type PageInput = { page: number; pageSize: number };

// Prisma skip/take for a page.
export const pageArgs = ({ page, pageSize }: PageInput) => ({ skip: (page - 1) * pageSize, take: pageSize });

export function toPage<T>(items: T[], total: number, { page, pageSize }: PageInput): Page<T> {
  return { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
