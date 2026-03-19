export type Database = {
  public: {
    Tables: Record<string, any>
    Views: Record<string, any>
    Functions: Record<string, any>
    Enums: Record<string, any>
  }
}
