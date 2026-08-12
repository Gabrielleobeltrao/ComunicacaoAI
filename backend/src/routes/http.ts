import type { Response, NextFunction } from 'express'
import { ObjectId } from 'mongodb'
import { ValidationError } from '../building.js'

// Shared route helpers. Kept tiny and framework-idiomatic (Express 5 forwards
// async rejections), so domain routers stay declarative.

export const oid = (id: string): ObjectId | null => (ObjectId.isValid(id) ? new ObjectId(id) : null)

// A valid-but-foreign or missing resource looks identical to the client: 404,
// never leaking whether the id exists for another owner.
export const notFound = (res: Response): void => {
  res.status(404).json({ code: 'not_found', message: 'not found' })
}

// Map a thrown error to a safe response: client input → 400, anything else is
// handed to Express's error handler (generic 500, no stack in production).
export const fail = (res: Response, error: unknown, next: NextFunction): void => {
  if (error instanceof ValidationError) {
    res.status(400).json({ code: 'invalid', message: error.message })
    return
  }
  next(error as Error)
}
