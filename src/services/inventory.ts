// src/services/inventory.ts
import { sql } from '../db/connect.js'
import { getOrgInventory, setOrgInventory } from '../lib/cache.js'

export type InventoryRow = {
  product_id: string
  organization_id: string
  sku: string | null
  ean: string | null
  title: string
  amount: number
  reserved: number
  threshold: number
}

/** Alle inventory voor een org uit DB ophalen */
async function fetchOrgInventoryFromDB(organizationId: string): Promise<InventoryRow[]> {
  const rows = (await sql`
    SELECT
      p.id AS product_id,
      p.organization_id,
      COALESCE(i.sku, p.slug) AS sku,
      COALESCE(i.ean, p.ean) AS ean,
      p.title,
      GREATEST(COALESCE(i.amount, 0) - COALESCE(i.reserved, 0), 0) AS amount,
      COALESCE(i.reserved, 0) AS reserved,
      COALESCE(i.threshold, 0) AS threshold
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.organization_id = ${organizationId}
    ORDER BY p.title;
  `) as InventoryRow[]
  return rows
}

/** Cache-first ophalen (in-memory singleton) */
export async function getInventoryForOrg(organizationId: string): Promise<InventoryRow[]> {
  const cached = getOrgInventory(organizationId)
  if (cached) return cached
  const fresh = await fetchOrgInventoryFromDB(organizationId)
  setOrgInventory(organizationId, fresh)
  return fresh
}

/** Eén product (uuid/sku/ean) binnen org; eerst cache, anders DB en cache verversen */
export async function getSingleProductFromCacheOrDB(organizationId: string, productId: string) {
  const list = await getInventoryForOrg(organizationId)
  const pid = productId.trim().toLowerCase()
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(pid)

  const fromCache = list.find(
    p => (isUUID && p.product_id.toLowerCase() === pid) || (p.sku && p.sku.toLowerCase() === pid) || (p.ean && p.ean.toLowerCase() === pid)
  )
  if (fromCache) return fromCache

  const row =
    (
      (await sql`
    SELECT
      p.id AS product_id,
      p.organization_id,
      COALESCE(i.sku, p.slug) AS sku,
      COALESCE(i.ean, p.ean) AS ean,
      p.title,
      GREATEST(COALESCE(i.amount, 0) - COALESCE(i.reserved, 0), 0) AS amount,
      COALESCE(i.reserved, 0) AS reserved,
      COALESCE(i.threshold, 0) AS threshold
    FROM products p
    LEFT JOIN inventory i ON i.product_id = p.id
    WHERE p.organization_id = ${organizationId}
      AND (
        p.id::text = ${productId}
        OR p.slug = ${productId}
        OR p.ean = ${productId}
        OR i.sku = ${productId}
        OR i.ean = ${productId}
      )
    LIMIT 1;
  `) as InventoryRow[]
    )[0] ?? null

  if (row) {
    const fresh = await fetchOrgInventoryFromDB(organizationId)
    setOrgInventory(organizationId, fresh)
  }
  return row
}

/** Reserveer voorraad (verlaag amount atomair); mock calls naar Monta; refresh cache */
export async function reserveProduct(opts: { organizationId: string; productIdOrKey: string; quantity: number }) {
  const { organizationId, productIdOrKey, quantity } = opts
  if (quantity <= 0) throw new Error('quantity must be > 0')

  let result: { ok: true; amount: number } | { ok: false; reason: 'insufficient_stock' } = { ok: false, reason: 'insufficient_stock' }

  await sql`BEGIN`
  try {
    // Product-id binnen organisatie opzoeken
    const prod = (
      await sql`
      SELECT p.id AS product_id
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.organization_id = ${organizationId}
        AND (p.id::text = ${productIdOrKey}
             OR p.slug = ${productIdOrKey}
             OR p.ean = ${productIdOrKey}
             OR i.sku = ${productIdOrKey}
             OR i.ean = ${productIdOrKey})
      LIMIT 1;
    `
    )[0]
    if (!prod) {
      await sql`ROLLBACK`
      return result // insufficient_stock
    }

    // Verlaag reserved; blokkeer als niet genoeg
    const updated = (
      await sql`
        UPDATE inventory
        SET reserved = reserved + ${quantity}, updated_at = NOW()
        WHERE product_id = ${prod.product_id}
          AND organization_id = ${organizationId}
          AND (amount - reserved) >= ${quantity}
        RETURNING amount, reserved, (amount - reserved) AS available_after;
      `
    )[0]

    if (!updated) {
      await sql`ROLLBACK`
      return result // insufficient_stock
    }

    await sql`COMMIT`

    // Mock calls naar Monta
    console.info('[MONTA][reserve]', { organizationId, productId: prod.product_id, quantity })
    console.info('[MONTA][get_stock_after_reserve]', { productId: prod.product_id, by: 'sku-or-ean' })

    // Mock: Monta zegt dezelfde amount terug
    const montaAmount = updated.amount

    // Cache verversen
    const fresh = await fetchOrgInventoryFromDB(organizationId)
    setOrgInventory(organizationId, fresh)

    result = { ok: true, amount: montaAmount }
    return result
  } catch (err) {
    // probeer rollback, maar gooi de originele fout opnieuw
    await sql`ROLLBACK`.catch(() => {
      console.warn('[TX] rollback failed (likely no open transaction)')
    })
    throw err
  }
}

// --- fulfill (na betaling): mock ship + mock stock refresh; update DB + cache; bundel “threshold” mail
export async function fulfillOrder(opts: { organizationId: string; items: Array<{ productIdOrKey: string; quantity: number }>; orderId: string }) {
  const { organizationId, items, orderId } = opts

  console.info('[MONTA][ship_order]', { organizationId, orderId, items })

  const low: Array<{ title: string; amount: number; threshold: number }> = []

  await sql`BEGIN`
  try {
    for (const it of items) {
      const found = (
        await sql`
      SELECT
        p.id AS product_id,
        p.title
      FROM products p
      LEFT JOIN inventory i ON i.product_id = p.id
      WHERE p.organization_id = ${organizationId}
        AND (p.id::text = ${it.productIdOrKey}
             OR p.slug = ${it.productIdOrKey}
             OR p.ean = ${it.productIdOrKey}
             OR i.sku = ${it.productIdOrKey}
             OR i.ean = ${it.productIdOrKey})
      LIMIT 1;
    `
      )[0]
      if (!found) continue

      // reservering definitief maken: amount én reserved omlaag met dezelfde qty
      const after = (
        await sql`
      UPDATE inventory
      SET
        amount     = amount    - ${it.quantity},
        reserved   = reserved  - ${it.quantity},
        updated_at = NOW()
      WHERE product_id = ${found.product_id}
        AND organization_id = ${organizationId}
        AND reserved >= ${it.quantity}
      RETURNING amount, threshold, ${found.title} AS title;
    `
      )[0]

      // als reserved te laag was, is er niets geüpdatet; sla over of log
      if (!after) {
        console.warn('[FULFILL][skip] reserved too low', { productId: found.product_id, quantity: it.quantity })
        continue
      }

      // optioneel: alleen logging naar “MONTA”
      console.info('[MONTA][get_stock_after_ship]', { productId: found.product_id })

      // drempel-check op de NIEUWE waarden
      if (after.amount <= after.threshold) {
        low.push({ title: after.title, amount: after.amount, threshold: after.threshold })
      }
    }

    await sql`COMMIT`
  } catch (err) {
    // probeer rollback, maar gooi de originele fout opnieuw
    await sql`ROLLBACK`.catch(() => {
      console.warn('[TX] rollback failed (likely no open transaction)')
    })
    throw err
  }

  // Cache refresh
  const fresh = await fetchOrgInventoryFromDB(organizationId)
  setOrgInventory(organizationId, fresh)

  // Bundel “mail” (mock) als iets onder drempel zit
  if (low.length) {
    console.info('[MAIL][threshold_reached]', {
      to: 'ops@example.com',
      organizationId,
      items: low
    })
  }

  return { ok: true as const, refreshed: true, lowCount: low.length }
}
