import { useEffect, useRef } from "react";
import { useAccountPublicData } from "@/lib/gis/AccountPublicData";
import { useWorkbench } from "@/lib/gis/store";
import { useAuth } from "@/lib/auth";

/** Materialize managed service connections only in editable maps as they open. */
export function AccountServiceLayers() {
  const wb = useWorkbench();
  const account = useAccountPublicData();
  const { user } = useAuth();
  const pending = useRef(new Set<string>());
  const project = useRef(wb.projectId);
  useEffect(() => {
    if (project.current !== wb.projectId) {
      project.current = wb.projectId;
      pending.current.clear();
    }
    if (!account.ready || !wb.projectReady || !wb.canEditProject) return;
    const managed = Object.values(account.config.services).filter(
      (service) => service.everyMap && !account.config.removed[`account:${service.id}`],
    );
    const remove = wb.layers.filter(
      (layer) =>
        layer.source.kind === "remote" &&
        layer.source.accountServiceId &&
        layer.source.accountOwnerId === user?.id &&
        !managed.some(
          (service) =>
            service.id === (layer.source.kind === "remote" ? layer.source.accountServiceId : null),
        ),
    );
    if (remove.length) wb.removeLayers(remove.map((layer) => layer.id));
    for (const service of managed) {
      const existing = wb.layers.find(
        (layer) =>
          layer.source.kind === "remote" &&
          (layer.source.accountServiceId === service.id || layer.source.url === service.url),
      );
      if (existing) {
        if (
          existing.source.kind === "remote" &&
          existing.source.accountServiceId === service.id &&
          existing.source.url !== service.url
        )
          wb.updateLayer(existing.id, { source: { ...existing.source, url: service.url } });
        pending.current.delete(service.id);
        continue;
      }
      if (pending.current.has(service.id)) continue;
      pending.current.add(service.id);
      wb.addLayer({
        name: service.name,
        data: { type: "FeatureCollection", features: [] },
        groupId: "public",
        source: {
          kind: "remote",
          url: service.url,
          accountServiceId: service.id,
          ...(user ? { accountOwnerId: user.id } : {}),
          requiresViewport: true,
          minZoom: 8,
        },
      });
    }
  }, [account.config, account.ready, wb, user]);
  return null;
}
