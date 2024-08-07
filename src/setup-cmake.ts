import * as tc from '@actions/tool-cache';
import * as core from '@actions/core';
import { promises as fsPromises } from 'fs';
import * as path from 'path';
import * as vi from './version-info';

const PACKAGE_NAME: string = 'cmake';

function getURL(
  version: vi.VersionInfo,
  arch_candidates: Array<string>
): string {
  core.debug(`Starting getURL with version: ${version.name} and arch_candidates: ${arch_candidates}`);
  
  const assets_for_platform: vi.AssetInfo[] = version.assets
    .filter((a) => a.platform === process.platform && a.filetype === 'archive')
    .sort();
  
  core.debug(`Filtered assets for platform ${process.platform}: ${assets_for_platform.map((a) => a.name)}`);

  let matching_assets = undefined;
  for (let arch of arch_candidates) {
    core.debug(`Checking arch: ${arch}`);
    const arch_assets = assets_for_platform.filter((a) => a.arch === arch);
    if (arch_assets.length != 0) {
      matching_assets = arch_assets;
      break;
    }
  }
  if (matching_assets == undefined) {
    core.debug(`No matching assets found for ${process.platform} with arch_candidates: ${arch_candidates}`);
    throw new Error(
      `Could not find ${process.platform} asset for cmake version ${version.name}`
    );
  }
  core.debug(
    `Assets matching platform and arch: ${matching_assets.map((a) => a.name)}`
  );
  
  if (matching_assets.length > 1) {
    core.debug(`Multiple matching assets found: ${matching_assets.map((a) => a.name)}`);
    const possible_assets = matching_assets.filter(
      (a) => a.url.match('64') || a.name.match(/macos-universal/)
    );
    if (possible_assets.length > 0) {
      matching_assets = possible_assets;
    }
    core.debug(`Filtered possible assets: ${possible_assets.map((a) => a.name)}`);
  }
  
  const asset_url: string = matching_assets[0].url;
  core.debug(`Using asset url: ${asset_url}`);
  return asset_url;
}

async function getArchive(url: string): Promise<string> {
  core.debug(`Downloading archive from URL: ${url}`);
  const download = await tc.downloadTool(url);
  core.debug(`Downloaded archive to: ${download}`);
  
  let extracted_path;
  if (url.endsWith('zip')) {
    extracted_path = await tc.extractZip(download);
  } else if (url.endsWith('tar.gz')) {
    extracted_path = await tc.extractTar(download);
  } else {
    throw new Error(`Could not determine filetype of ${url}`);
  }
  core.debug(`Extracted archive to: ${extracted_path}`);
  return extracted_path;
}

export async function addCMakeToToolCache(
  version: vi.VersionInfo,
  arch_candidates: Array<string>
): Promise<string> {
  core.debug(`Starting addCMakeToToolCache for version: ${version.name}`);
  const extracted_archive = await getArchive(getURL(version, arch_candidates));
  const cached_dir = await tc.cacheDir(extracted_archive, PACKAGE_NAME, version.name);
  core.debug(`Cached CMake directory: ${cached_dir}`);
  return cached_dir;
}

async function getBinDirectoryFrom(tool_path: string): Promise<string> {
  core.debug(`Getting bin directory from tool path: ${tool_path}`);
  const root_dir_path = await fsPromises.readdir(tool_path);
  core.debug(`Root directory content: ${root_dir_path}`);

  if (root_dir_path.length != 1) {
    throw new Error('Archive does not have expected layout.');
  }

  let bin_directory;
  if (process.platform === 'darwin') {
    const base = path.join(tool_path, root_dir_path[0]);
    core.debug(`Base path on Darwin: ${base}`);
    const app_dir = await fsPromises.readdir(base);
    core.debug(`App directory content on Darwin: ${app_dir}`);
    bin_directory = path.join(base, app_dir[0], 'Contents', 'bin');
  } else {
    bin_directory = path.join(tool_path, root_dir_path[0], 'bin');
  }

  core.debug(`Final bin directory: ${bin_directory}`);
  return bin_directory;
}

export async function addCMakeToPath(
  version: vi.VersionInfo,
  arch_candidates: Array<string>
): Promise<void> {
  core.debug(`Starting addCMakeToPath for version: ${version.name}`);
  let tool_path: string = tc.find(PACKAGE_NAME, version.name);
  core.debug(`Found tool path in cache: ${tool_path}`);
  
  if (!tool_path) {
    core.debug(`Tool not found in cache, adding to cache`);
    tool_path = await addCMakeToToolCache(version, arch_candidates);
  }

  const bin_dir = await getBinDirectoryFrom(tool_path);
  core.debug(`Adding bin directory to PATH: ${bin_dir}`);
  await core.addPath(bin_dir);
}