type CacheItem = {
  value: any
}
const cache = new Map<string, CacheItem>()
const key = (orgId: string) => `inventory:list:${orgId}`

export function getOrgInventory(orgId: string) {
  return cache.get(key(orgId))?.value ?? null
}
export function setOrgInventory(orgId: string, payload: any) {
  cache.set(key(orgId), { value: payload })
}
export function clearOrgInventory(orgId: string) {
  cache.delete(key(orgId))
}
