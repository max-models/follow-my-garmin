export interface CollectionActivity {
  livetrackUrl?: string | null;
  notes?: string;
}

export interface Collection {
  name: string;
  activities: CollectionActivity[];
}

export interface TripData {
  collections: Collection[];
}
