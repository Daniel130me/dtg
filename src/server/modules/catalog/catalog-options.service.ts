import { CategoryStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/server/db/client";
import { ApiError } from "@/server/http/errors";

const optionInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80, "Names must be 80 characters or fewer."),
});

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export async function listOwnerCatalogOptions() {
  const [categories, levels] = await Promise.all([
    db.category.findMany({
      where: { status: CategoryStatus.ACTIVE },
      orderBy: { sortOrder: "asc" },
      select: { id: true, slug: true, name: true, icon: true, sortOrder: true },
    }),
    db.courseLevelOption.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, sortOrder: true },
    }),
  ]);
  return { categories, levels };
}

export async function createOwnerCategory(input: unknown) {
  const value = optionInputSchema.parse(input);
  const slug = slugify(value.name);
  if (!slug) throw new ApiError(422, "INVALID_CATEGORY_NAME", "Choose a category name using letters or numbers.");
  try {
    return await db.category.create({
      data: { name: value.name, slug, icon: "BookOpen" },
      select: { id: true, slug: true, name: true, icon: true, sortOrder: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "CATEGORY_EXISTS", "That category already exists.");
    }
    throw error;
  }
}

export async function createOwnerLevel(input: unknown) {
  const value = optionInputSchema.parse(input);
  const slug = slugify(value.name);
  if (!slug) throw new ApiError(422, "INVALID_LEVEL_NAME", "Choose a level name using letters or numbers.");
  try {
    return await db.courseLevelOption.create({
      data: { name: value.name, slug },
      select: { id: true, slug: true, name: true, sortOrder: true },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new ApiError(409, "LEVEL_EXISTS", "That level already exists.");
    }
    throw error;
  }
}