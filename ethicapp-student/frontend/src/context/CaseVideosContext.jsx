import { createContext, useContext, useMemo } from 'react';
import { indexCaseVideos } from '../utils/videoFacade.js';

// The activity case's videos (#786), so a video facade anywhere in the
// activity can show its duration and availability. Outside a provider, or
// before the case loads, no video has metadata.
const CaseVideosContext = createContext(new Map());

export function CaseVideosProvider({ videos, children }) {
  const videosById = useMemo(() => indexCaseVideos(videos), [videos]);

  return <CaseVideosContext.Provider value={videosById}>{children}</CaseVideosContext.Provider>;
}

/** The case's metadata for a video id, or null when unknown. */
export function useCaseVideoMetadata(videoId) {
  return useContext(CaseVideosContext).get(videoId) ?? null;
}
