const nullableString = { type: "string", nullable: true } as const;

const yearMonthSchema = {
  type: "object",
  nullable: true,
  required: ["year", "month"],
  properties: {
    year: { type: "integer" },
    month: { type: "integer", nullable: true }
  }
} as const;

const dateRangeSchema = {
  type: "object",
  nullable: true,
  required: ["start", "end", "isCurrent"],
  properties: {
    start: yearMonthSchema,
    end: yearMonthSchema,
    isCurrent: { type: "boolean" }
  }
} as const;

export const profileRequestSchema = {
  type: "object",
  additionalProperties: false,
  required: ["url"],
  properties: {
    url: {
      type: "string",
      format: "uri",
      examples: ["https://www.linkedin.com/in/satyanadella/"]
    },
    refresh: { type: "boolean", default: false }
  }
} as const;

export const errorResponseSchema = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" }
      }
    }
  }
} as const;

export const healthResponseSchema = {
  type: "object",
  properties: {
    status: { type: "string" },
    linkedInSessionConfigured: { type: "boolean" },
    readinessCheckConfigured: { type: "boolean" }
  }
} as const;

export const readinessResponseSchema = {
  type: "object",
  required: ["status", "linkedIn"],
  properties: {
    status: { type: "string", enum: ["ready", "not_ready"] },
    linkedIn: {
      type: "object",
      required: ["authenticated", "checkedAt", "durationMs", "reason", "cache"],
      properties: {
        authenticated: { type: "boolean" },
        checkedAt: { type: "string", format: "date-time" },
        durationMs: { type: "integer" },
        reason: { type: "string", nullable: true },
        cache: { type: "string", enum: ["hit", "miss"] }
      }
    }
  }
} as const;

export const profileResponseSchema = {
  type: "object",
  required: ["data", "meta"],
  properties: {
    data: {
      type: "object",
      required: [
        "source",
        "name",
        "headline",
        "location",
        "about",
        "experience",
        "education",
        "skills",
        "certifications",
        "languages",
        "profileImages"
      ],
      properties: {
        source: {
          type: "object",
          required: ["profileUrl", "publicIdentifier", "fetchedAt", "extractionMode", "partial"],
          properties: {
            profileUrl: { type: "string", format: "uri" },
            publicIdentifier: { type: "string" },
            fetchedAt: { type: "string", format: "date-time" },
            extractionMode: {
              type: "array",
              items: { type: "string", enum: ["network", "json-ld", "html", "rsc"] }
            },
            partial: { type: "boolean" }
          }
        },
        name: {
          type: "object",
          required: ["full", "first", "last"],
          properties: { full: nullableString, first: nullableString, last: nullableString }
        },
        headline: nullableString,
        location: nullableString,
        about: nullableString,
        experience: {
          type: "array",
          items: {
            type: "object",
            required: [
              "title",
              "company",
              "companyLinkedInUrl",
              "employmentType",
              "location",
              "description",
              "dateRange"
            ],
            properties: {
              title: { type: "string" },
              company: nullableString,
              companyLinkedInUrl: nullableString,
              employmentType: nullableString,
              location: nullableString,
              description: nullableString,
              dateRange: dateRangeSchema
            }
          }
        },
        education: {
          type: "array",
          items: {
            type: "object",
            required: [
              "school",
              "schoolLinkedInUrl",
              "degree",
              "fieldOfStudy",
              "activities",
              "description",
              "dateRange"
            ],
            properties: {
              school: { type: "string" },
              schoolLinkedInUrl: nullableString,
              degree: nullableString,
              fieldOfStudy: nullableString,
              activities: nullableString,
              description: nullableString,
              dateRange: dateRangeSchema
            }
          }
        },
        skills: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "endorsementCount"],
            properties: {
              name: { type: "string" },
              endorsementCount: { type: "integer", nullable: true }
            }
          }
        },
        certifications: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "authority", "licenseNumber", "credentialUrl", "dateRange"],
            properties: {
              name: { type: "string" },
              authority: nullableString,
              licenseNumber: nullableString,
              credentialUrl: nullableString,
              dateRange: dateRangeSchema
            }
          }
        },
        languages: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "proficiency"],
            properties: { name: { type: "string" }, proficiency: nullableString }
          }
        },
        profileImages: {
          type: "object",
          required: ["profile", "background"],
          properties: { profile: nullableString, background: nullableString }
        }
      }
    },
    meta: {
      type: "object",
      required: ["requestId", "durationMs", "cache", "warnings"],
      properties: {
        requestId: { type: "string" },
        durationMs: { type: "integer" },
        cache: { type: "string", enum: ["hit", "miss"] },
        warnings: { type: "array", items: { type: "string" } }
      }
    }
  }
} as const;

export const profileErrorResponses = {
  400: errorResponseSchema,
  401: errorResponseSchema,
  404: errorResponseSchema,
  429: errorResponseSchema,
  500: errorResponseSchema,
  502: errorResponseSchema,
  503: errorResponseSchema,
  504: errorResponseSchema
} as const;
