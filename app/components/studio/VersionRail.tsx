"use client";
/* eslint-disable @next/next/no-img-element */
import { ArrowUpRight } from "lucide-react";
import type { Asset, StudioController } from "../../lib/types";
import { assetVersions } from "./studio-model";

export interface VersionRailProps {
  controller: StudioController;
  currentAsset: Asset | null;
  onSelectVersion?: (asset: Asset) => void;
  onCompare?: () => void;
}

export function VersionRail({ controller: c, currentAsset, onSelectVersion, onCompare }: VersionRailProps) {
  if (!currentAsset || currentAsset.type !== "image") return null;
  const versions = assetVersions(currentAsset, c.allAssets).filter(asset => asset.type === "image");
  return <div className="studio-version-rail"><nav className="studio-version-rail-list" aria-label="Image versions">{versions.map((asset, index) => <button key={asset.id} className={asset.id === currentAsset.id ? "is-selected" : ""} aria-pressed={asset.id === currentAsset.id} title={asset.name} onClick={() => onSelectVersion ? onSelectVersion(asset) : c.useAsset(asset, "edit")}><img src={asset.url} alt="" loading="lazy" /><span>{index === 0 && !asset.parentAssetId ? "Original" : `Version ${index + 1}`}</span></button>)}</nav><button className="studio-button studio-version-review" onClick={() => onCompare ? onCompare() : c.openAsset(currentAsset)}>Review / compare<ArrowUpRight size={14} /></button></div>;
}
