export type TripStatus = "planned" | "riding" | "finished" | "rest day" | "cancelled";

export interface TripDetails {
  title: string;
  subtitle: string;
  riderName?: string;
}

export interface TripDay {
  date: string;
  title: string;
  location?: string;
  status?: TripStatus;
  livetrackUrl?: string | null;
  notes?: string;
}

export interface TripData {
  trip: TripDetails;
  days: TripDay[];
}

export const tripData = {
  trip: {
    title: "Bikepacking Trip",
    subtitle:
      "One stable page for the live Garmin session plus the full day-by-day route archive.",
    riderName: "Your name",
  },
  days: [
    {
      date: "2026-06-02",
      title: "Day 1 - Departure",
      location: "Start town to first campsite",
      status: "riding",
      livetrackUrl:
        "https://livetrack.garmin.com/session/75d067c2-fde9-88e2-b508-6a9b61245200/token/647A34545C325599622E92BE268B2F8",
      notes:
        "Replace this sample with the Garmin LiveTrack link generated when you start riding.",
    },
    {
      date: "2026-06-03",
      title: "Day 2 - Mountain pass",
      location: "Campsite to mountain village",
      status: "planned",
      livetrackUrl: null,
      notes: "Leave livetrackUrl empty until that day's Garmin session exists.",
    },
    {
      date: "2026-06-04",
      title: "Day 3 - Rest day",
      location: "Mountain village",
      status: "rest day",
      livetrackUrl: null,
      notes: "Rest days can stay in the timeline without a Garmin embed.",
    },
  ],
} satisfies TripData;
