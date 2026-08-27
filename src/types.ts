export type YearMonth = {
  year: number;
  month: number | null;
};

export type DateRange = {
  start: YearMonth | null;
  end: YearMonth | null;
  isCurrent: boolean;
};

export type Experience = {
  title: string;
  company: string | null;
  companyLinkedInUrl: string | null;
  employmentType: string | null;
  location: string | null;
  description: string | null;
  dateRange: DateRange | null;
};

export type Education = {
  school: string;
  schoolLinkedInUrl: string | null;
  degree: string | null;
  fieldOfStudy: string | null;
  activities: string | null;
  description: string | null;
  dateRange: DateRange | null;
};

export type Certification = {
  name: string;
  authority: string | null;
  licenseNumber: string | null;
  credentialUrl: string | null;
  dateRange: DateRange | null;
};

export type Language = {
  name: string;
  proficiency: string | null;
};

export type ProfileImages = {
  profile: string | null;
  background: string | null;
};

export type LinkedInProfile = {
  source: {
    profileUrl: string;
    publicIdentifier: string;
    fetchedAt: string;
    extractionMode: Array<"network" | "json-ld" | "dom">;
    partial: boolean;
  };
  name: {
    full: string | null;
    first: string | null;
    last: string | null;
  };
  headline: string | null;
  location: string | null;
  about: string | null;
  experience: Experience[];
  education: Education[];
  skills: Array<{ name: string; endorsementCount: number | null }>;
  certifications: Certification[];
  languages: Language[];
  profileImages: ProfileImages;
};

export type ScrapeResult = {
  profile: LinkedInProfile;
  warnings: string[];
};

export type DomSnapshot = {
  name: string | null;
  headline: string | null;
  location: string | null;
  profileImage: string | null;
  backgroundImage: string | null;
  jsonLd: unknown[];
  sections: Array<{
    heading: string;
    text: string;
    items: string[][];
    lines?: string[];
    links?: Array<{ text: string[]; path: string | null }>;
  }>;
};
