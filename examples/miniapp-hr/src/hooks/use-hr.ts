"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { AssetsResponse } from "@/app/api/assets/route";
import type { ReferencesResponse } from "@/app/api/references/route";
import { ApiError, api, apiJson } from "@/lib/client/api";
import type { MeResponse, RecordRow } from "@/lib/domain/types";

interface ListResponse {
  items: RecordRow[];
}

export const queryKeys = {
  me: ["me"] as const,
  references: ["references"] as const,
  directory: ["directory"] as const,
  assets: ["assets"] as const,
  policies: ["policies"] as const,
  collection: (path: string) => ["collection", path] as const,
};

const message = (error: unknown) =>
  error instanceof ApiError || error instanceof Error ? error.message : "Đã có lỗi xảy ra";

export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<MeResponse>("api/me"),
    staleTime: 30_000,
  });
}

export function useReferences() {
  return useQuery({
    queryKey: queryKeys.references,
    queryFn: () => api<ReferencesResponse>("api/references"),
    staleTime: 5 * 60_000,
  });
}

export function useDirectory() {
  return useQuery({
    queryKey: queryKeys.directory,
    queryFn: () => api<ListResponse>("api/directory"),
    staleTime: 60_000,
  });
}

export function useAssets() {
  return useQuery({
    queryKey: queryKeys.assets,
    queryFn: () => api<AssetsResponse>("api/assets"),
    staleTime: 60_000,
  });
}

export function usePolicies() {
  return useQuery({
    queryKey: queryKeys.policies,
    queryFn: () => api<ListResponse>("api/policies"),
    staleTime: 5 * 60_000,
  });
}

export function useCollection(path: string) {
  return useQuery({
    queryKey: queryKeys.collection(path),
    queryFn: () => api<ListResponse>(`api/${path}`),
    staleTime: 30_000,
  });
}

export function useSaveRecord(path: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, values }: { id?: string; values: unknown }) =>
      id
        ? apiJson<RecordRow>(`api/${path}/${id}`, "PUT", values)
        : apiJson<RecordRow>(`api/${path}`, "POST", values),
    onSuccess: (_data, variables) => {
      client.invalidateQueries({ queryKey: queryKeys.collection(path) });
      toast.success(variables.id ? "Đã cập nhật" : "Đã thêm mới");
    },
    onError: (error) => toast.error(message(error)),
  });
}

export function useDeleteRecord(path: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api(`api/${path}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: queryKeys.collection(path) });
      toast.success("Đã xoá");
    },
    onError: (error) => toast.error(message(error)),
  });
}

export function useSaveProfile() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (values: unknown) => apiJson<MeResponse>("api/profile", "PUT", values),
    onSuccess: (data) => {
      client.setQueryData(queryKeys.me, data);
      client.invalidateQueries({ queryKey: queryKeys.directory });
      client.invalidateQueries({ queryKey: queryKeys.references });
      toast.success("Đã lưu hồ sơ");
    },
    onError: (error) => toast.error(message(error)),
  });
}
