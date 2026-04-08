import { apiClient } from './client';
import type { WikiPage, WikiPageDetail } from '../types';

export const getWikiPages = (kbId: string) =>
  apiClient.get<WikiPage[]>(`/knowledge-bases/${kbId}/wiki-pages`);

export const getWikiPage = (kbId: string, pageId: string) =>
  apiClient.get<WikiPageDetail>(`/knowledge-bases/${kbId}/wiki-pages/${pageId}`);
