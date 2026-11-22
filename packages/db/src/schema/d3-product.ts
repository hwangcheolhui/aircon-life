/** D3 상품·가격 (01_ERD §2.3) */
import { bigint, boolean, date, integer, jsonb, pgTable, smallint, text, varchar } from 'drizzle-orm/pg-core';
import { branch } from './d1-org';
import { auditColumns, idColumn, softDelete } from './common';

/** 2.3.1 서비스 카테고리 */
export const serviceCategory = pgTable('service_category', {
  id: idColumn(),
  code: varchar('code', { length: 20 }).notNull().unique(),
  name: varchar('name', { length: 50 }).notNull(),
  phase: smallint('phase'),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
});

/** 2.3.2 서비스 상품 */
export const serviceProduct = pgTable('service_product', {
  id: idColumn(),
  categoryId: bigint('category_id', { mode: 'number' })
    .notNull()
    .references(() => serviceCategory.id),
  productCode: varchar('product_code', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  deviceType: varchar('device_type', { length: 20 }).notNull(), // DEVICE_TYPE
  cleanLevel: varchar('clean_level', { length: 20 }).notNull(), // CLEAN_LEVEL
  baseDurationMin: integer('base_duration_min').notNull(),
  requiredTechCount: smallint('required_tech_count').notNull().default(1),
  requiredSkillLevel: varchar('required_skill_level', { length: 20 }), // TECH_GRADE
  description: text('description'),
  includedItems: text('included_items'),
  excludedItems: text('excluded_items'),
  warrantyDays: integer('warranty_days').notNull().default(30),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
  ...softDelete,
});

/** 2.3.3 가격 정책 */
export const pricePolicy = pgTable('price_policy', {
  id: idColumn(),
  productId: bigint('product_id', { mode: 'number' })
    .notNull()
    .references(() => serviceProduct.id),
  branchId: bigint('branch_id', { mode: 'number' }).references(() => branch.id),
  customerType: varchar('customer_type', { length: 20 }), // CUSTOMER_TYPE
  unitPrice: integer('unit_price').notNull(),
  multiUnitDiscountJson: jsonb('multi_unit_discount_json').$type<{ min: number; rate: number }[]>(),
  validFrom: date('valid_from', { mode: 'string' }).notNull(),
  validTo: date('valid_to', { mode: 'string' }),
  priority: integer('priority').notNull().default(0),
  ...auditColumns,
});

/** 2.3.4 할증·추가요금 규칙 */
export const surchargeRule = pgTable('surcharge_rule', {
  id: idColumn(),
  ruleCode: varchar('rule_code', { length: 30 }).notNull().unique(), // SURCHARGE_RULE
  name: varchar('name', { length: 50 }).notNull(),
  applyType: varchar('apply_type', { length: 20 }).notNull(), // SURCHARGE_APPLY_TYPE
  conditionJson: jsonb('condition_json').$type<Record<string, unknown>>(),
  amountType: varchar('amount_type', { length: 10 }).notNull(), // AMOUNT_TYPE
  amount: integer('amount').notNull(),
  perUnit: boolean('per_unit').notNull().default(false),
  customerNotice: varchar('customer_notice', { length: 300 }),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
});

/** 2.3.5 부가 옵션 */
export const serviceOption = pgTable('service_option', {
  id: idColumn(),
  productId: bigint('product_id', { mode: 'number' }).references(() => serviceProduct.id),
  optionCode: varchar('option_code', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  price: integer('price').notNull(),
  durationMin: integer('duration_min').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
});

/** 2.3.6 자재·소모품 */
export const material = pgTable('material', {
  id: idColumn(),
  materialCode: varchar('material_code', { length: 30 }).notNull().unique(),
  name: varchar('name', { length: 100 }).notNull(),
  unit: varchar('unit', { length: 10 }).notNull(), // MATERIAL_UNIT
  unitCost: integer('unit_cost').notNull().default(0),
  salePrice: integer('sale_price').notNull().default(0),
  safetyStock: integer('safety_stock').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...auditColumns,
});

