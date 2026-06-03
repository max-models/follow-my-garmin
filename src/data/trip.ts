export interface CollectionActivity {
  livetrackUrl?: string | null;
  notes?: string;
  routeGpxFile?: string | null;
}

export interface Collection {
  name: string;
  activities: CollectionActivity[];
}

export interface TripData {
  collections: Collection[];
}
