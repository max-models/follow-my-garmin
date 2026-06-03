export type TripStatus = "planned" | "riding" | "finished" | "rest day" | "cancelled";

export interface TripDetails {
  title: string;
  subtitle: string;
  riderName?: string;
}

export interface TripActivity {
  id: string;
  title: string;
  color: string;
  livetrackUrl?: string | null;
  notes?: string;
}

export interface TripDay {
  date: string;
  title: string;
  location?: string;
  status?: TripStatus;
  livetrackUrl?: string | null;
  notes?: string;
  activities?: TripActivity[];
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
      notes: "Replace these sample activities with the Garmin LiveTrack links generated when you start riding.",
      activities: [
        {
          id: "morning-rollout",
          title: "Morning rollout",
          color: "#60a5fa",
          livetrackUrl:
            "https://livetrack.garmin.com/session/75d067c2-fde9-88e2-b508-6a9b61245200/token/647A34545C325599622E92BE268B2F8",
          notes: "Sample route used to populate the custom map.",
        },
        {
          id: "evening-spin",
          title: "Evening spin",
          color: "#f97316",
          livetrackUrl: "https://livetrack.garmin.com/auth/sign-in?redirect=%2Fsession%2F37ddc630-f92c-8d38-9e31-88b9cba7e000%2Ftoken%2F5D1ECDF5FD5FEB867A3689951D08DB5&gateway=true",
          notes: "Add a second Garmin session here if the day contains another activity.",
        },
      ],
    },
    {
      date: "2026-06-03",
      title: "Day 2 - Mountain pass",
      location: "Campsite to mountain village",
      status: "planned",
      notes: "Leave the activity URLs empty until those Garmin sessions exist.",
      activities: [
        {
          id: "main-route",
          title: "Main route",
          color: "#22c55e",
          livetrackUrl: null,
        },
      ],
    },
    {
      date: "2026-06-04",
      title: "Day 3 - Rest day",
      location: "Mountain village",
      status: "rest day",
      livetrackUrl: null,
      notes: "Rest days can stay in the timeline without any activity routes.",
    },
  ],
} satisfies TripData;
