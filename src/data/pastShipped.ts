/**
 * Every version a content table was shipped in by a build that writes the old whole-bundle
 * override format, as the eight-digit `tableHash` of the table. The content editor of such a
 * build saved the whole bundle on every Apply, edited or not, so an old stored table that hashes
 * to one of these is an untouched copy of a shipped table and not an edit of the player's.
 * `buildContent` in `content.ts` drops it instead of converting it into an override of an
 * outdated table.
 *
 * How the list was made, once, on 2026-10-11. The builds are the 389 commits of every remote
 * branch that do not contain 0beae08, the commit that introduced the per-table format (`git
 * rev-list --remotes`, less the descendants of 0beae08 and 0beae08 itself). In each revision every
 * table was composed from the JSON files of its `src/data` the way `SHIPPED` composes it today:
 * cargo is cargo.json then cargo_full.json, stations are `{ levels, defs: stations.json defs then
 * stations_full.json }`, buildings are buildings.json then buildings_full.json, every other table
 * is its one file. A file missing in a revision counts as empty; a table with no file at all has
 * no entry for that revision. The composed table was hashed with `tableHash`, and the distinct
 * hashes of each table are listed here, sorted.
 *
 * The list is closed and never extended. A build that contains 0beae08 stores overrides per table
 * with a stamp, so a table shipped after it cannot be in an old whole-bundle value; a later change
 * to a shipped table changes its stamp and leaves this list alone.
 */
import type { ContentKey } from './content';

const list = (...hashes: string[]): readonly string[] => Object.freeze(hashes);

export const PAST_SHIPPED: Readonly<Record<ContentKey, readonly string[]>> = Object.freeze({
  locomotives: list(
    '0a37f421',
    '0d1db132',
    '1ba3adae',
    '2513b596',
    '45a10f42',
    '501972db',
    '50f48d96',
    '5c6a27fc',
    '78ac0579',
    '96675d6c',
    '98ef9f6a',
    '9a71de48',
    'a2455262',
    'a436e02a',
    'ae3ce6c6',
    'bcd55d10',
    'c51a28e4',
    'e47a881f',
    'f9d22a80',
  ),
  wagons: list(
    '0d31aee5',
    '0db82e65',
    '1dac60e8',
    '393bbba7',
    '68b4c001',
    '6a8f81bd',
    '92b1c015',
    '9f4bac64',
  ),
  cargo: list('0de9c7a8', '2214578b', '947b025d', '9e89cb3b', 'be2d7f53'),
  stations: list(
    '19f58515',
    '274c1a6e',
    '369fb2cb',
    'c20a7fd7',
    'c9cb0950',
    'd6c0a8b5',
    'e61dd59f',
    'f2c2605c',
  ),
  contracts: list('16aa0709', '39fa427f', '96197a5b', 'e3a2cadc'),
  decor: list(
    '33352031',
    '74e3591b',
    '872e97ff',
    '8ecc3f95',
    'a44b3fcc',
    'bc79ed91',
    'c1de226d',
    'f7cf63f2',
  ),
  buildings: list(
    '08359300',
    '3543279c',
    '855e1283',
    '985648b0',
    'b694cbcb',
    'bbc79bda',
    'e4bbb044',
    'f0adc3d0',
    'ff6251e3',
  ),
  gacha: list('06641837', '2039c8bb', '943105da', 'b3e7aaa0', 'fc9d4ee3'),
  track: list('0d0c78a4', '28c50e02', '51bab72e', '68ebecc5', '856d16ce', 'aa527faa', 'ee87cabb'),
  crafting: list('8f4c7a87'),
  houses: list('31ef4dd4', '4444dc55'),
});
