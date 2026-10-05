/** Keep user-facing recognition failures free of credentials, request bodies and remote error echoes. */
export class RecognitionError extends Error {
  /** Retain only an application-authored safe error message. */
  constructor(message: string) {
    super(message)
    this.name = 'RecognitionError'
  }
}
