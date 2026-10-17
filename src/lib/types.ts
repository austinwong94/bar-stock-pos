export type Role = 'cashier' | 'manager' | 'admin';
export type DbRole = Role | 'locked';
export type PaymentMethod = 'cash' | 'qr' | 'complimentary';
export type QrStatus = 'not_applicable' | 'pending' | 'verified' | 'mismatch';

export type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
  app_access_granted?: boolean;
  app_access_granted_at?: string | null;
  admin_access_expires_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type Product = {
  id: string;
  name: string;
  category_id: string | null;
  price_per_unit: number;
  cost_per_unit: number | null;
  carton_size: number;
  low_stock_threshold: number;
  active: boolean;
  image_url?: string | null;
  created_at: string;
  updated_at: string;
  categories?: Pick<Category, 'id' | 'name' | 'sort_order'> | null;
  inventory_balances?: Pick<InventoryBalance, 'quantity_on_hand'> | null;
};

export type InventoryBalance = {
  product_id: string;
  quantity_on_hand: number;
  updated_at: string;
};

export type ProductWithStock = Product & {
  categories: Pick<Category, 'id' | 'name' | 'sort_order'> | null;
  inventory_balances: Pick<InventoryBalance, 'quantity_on_hand'> | null;
};

export type InventoryBaseUnit = 'ml' | 'g' | 'unit';
export type IngredientCategory = 'Liquor' | 'Mixer' | 'Seafood' | 'Condiment' | 'Food' | 'Other';

export type IngredientBalance = {
  ingredient_id: string;
  quantity_on_hand: number;
  updated_at: string;
};

export type IngredientItem = {
  kitchen_key?: string;
  kitchen_label?: string;
  kitchen_group?: import('./kitchenCatalogue').KitchenGroup;
  kitchen_unit?: string;
  kitchen_factor?: number | null;
  kitchen_scopes?: import('./kitchenCatalogue').KitchenScope[];
  kitchen_order?: number;
  id: string;
  name: string;
  category: IngredientCategory;
  base_unit: InventoryBaseUnit;
  default_pack_size: number;
  pack_label: string;
  cost_per_base_unit: number | null;
  low_stock_threshold: number;
  active: boolean;
  created_at: string;
  updated_at: string;
  ingredient_balances?: Pick<IngredientBalance, 'quantity_on_hand'> | Array<Pick<IngredientBalance, 'quantity_on_hand'>> | null;
};

export type IngredientWithBalance = IngredientItem & {
  ingredient_balances?: Pick<IngredientBalance, 'quantity_on_hand'> | Array<Pick<IngredientBalance, 'quantity_on_hand'>> | null;
};

export type RecipeIngredient = {
  id: string;
  product_id: string;
  ingredient_id: string;
  quantity_per_unit: number;
  unit: InventoryBaseUnit;
  created_at: string;
  ingredient_items?: Pick<IngredientItem, 'id' | 'name' | 'category' | 'base_unit'> | null;
};

export type IngredientMovement = {
  display_unit?: string | null;
  display_factor?: number | null;
  id: string;
  ingredient_id: string;
  movement_type: 'stock_in' | 'sale' | 'complimentary' | 'void_sale' | 'kitchen_production' | 'waste' | 'adjustment' | 'count';
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  unit_input: string | null;
  input_quantity: number | null;
  pack_size_at_time: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  notes: string | null;
  entered_by?: string | null;
  created_by: string | null;
  created_at: string;
  ingredient_items?: Pick<IngredientItem, 'name' | 'base_unit' | 'kitchen_label'> | null;
};


export type KitchenDailyPax = {
  id: string;
  business_date: string;
  pax_count: number;
  entered_by: string | null;
  notes: string | null;
  updated_by: string | null;
  updated_at: string;
};

export type KitchenProductionItem = {
  id: string;
  report_id: string;
  ingredient_id: string;
  quantity_per_platter: number;
  total_quantity: number;
  unit: InventoryBaseUnit;
  notes: string | null;
  ingredient_items?: Pick<IngredientItem, 'id' | 'name' | 'category' | 'base_unit'> | null;
};

export type KitchenProductionReport = {
  meal_purpose?: 'guest_meals' | 'staff_meals' | null;
  meals_prepared?: number | null;
  id: string;
  business_date: string;
  platter_name: string;
  platter_count: number;
  serving_basis: 'pax' | 'table' | 'batch';
  submitted_by: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  kitchen_production_items?: KitchenProductionItem[];
};

export type ProductPriceHistory = {
  id: string;
  product_id: string;
  product_name: string;
  old_price_per_unit: number | null;
  new_price_per_unit: number | null;
  old_cost_per_unit: number | null;
  new_cost_per_unit: number | null;
  changed_by: string | null;
  changed_at: string;
  products?: Pick<Product, 'name'> | null;
  profiles?: Pick<Profile, 'full_name'> | null;
};

export type Sale = {
  id: string;
  sale_number: string;
  business_date: string;
  payment_method: PaymentMethod;
  status: 'completed' | 'voided';
  total_amount: number;
  paid_amount: number;
  discount_amount?: number;
  order_taken_by?: string | null;
  table_number?: string | null;
  complimentary_reason: string | null;
  qr_reference: string | null;
  qr_payment_type?: string | null;
  qr_receipt_image_path?: string | null;
  qr_status: QrStatus;
  cashier_id: string | null;
  voided_by: string | null;
  void_reason: string | null;
  voided_at: string | null;
  idempotency_key: string | null;
  created_at: string;
};

export type SaleItem = {
  id: string;
  sale_id: string;
  product_id: string | null;
  custom_item_name?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  created_at: string;
  products?: Pick<Product, 'name'> | null;
};

export type StockMovement = {
  id: string;
  product_id: string | null;
  movement_type: 'stock_in' | 'sale' | 'complimentary' | 'void_sale' | 'adjustment';
  quantity_change: number;
  quantity_before: number;
  quantity_after: number;
  unit_input: 'can' | 'carton' | 'system' | null;
  input_quantity: number | null;
  carton_size_at_time: number | null;
  reference_type: string | null;
  reference_id: string | null;
  reason: string | null;
  notes: string | null;
  entered_by?: string | null;
  created_by: string | null;
  created_at: string;
  products?: Pick<Product, 'name'> | null;
};

export type StockInDraftStatus = 'draft' | 'confirmed' | 'cancelled';

export type StockInDraftEntry = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit: 'can' | 'carton';
  carton_size: number;
  cans: number;
  cost_per_unit: number | null;
};

export type StockInDraftRecord = {
  id: string;
  draft_number: string;
  status: StockInDraftStatus;
  entered_by: string | null;
  supplier: string | null;
  reference: string | null;
  notes: string | null;
  entries: StockInDraftEntry[];
  total_units: number;
  created_by: string | null;
  confirmed_by: string | null;
  cancelled_by?: string | null;
  created_at: string;
  confirmed_at: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
};

export type AppSettingKey =
  | 'business_name'
  | 'currency_symbol'
  | 'secondary_currency_symbol'
  | 'rmb_exchange_rate'
  | 'business_day_close_time'
  | 'default_carton_size'
  | 'allow_negative_stock'
  | 'require_qr_reference'
  | 'require_manager_approval_for_complimentary'
  | 'staff_names'
  | 'beer_bundle_enabled'
  | 'beer_bundle_name'
  | 'beer_bundle_units_per_set'
  | 'beer_bundle_price'
  | 'receipt_footer_text'
  | 'platform_name'
  | 'allow_access_code_login'
  | 'access_code_role'
  | 'pickup_group_radius_km'
  | 'default_departure_time';

export type SettingsMap = Record<AppSettingKey, string | number | boolean>;

export type DailyReport = {
  id: string;
  business_date: string;
  report_json: Record<string, unknown>;
  total_cash: number;
  total_qr: number;
  total_complimentary_value: number;
  total_sales: number;
  actual_cash_counted: number | null;
  expected_cash: number | null;
  cash_variance: number | null;
  closed_by: string | null;
  closed_at: string;
  reopened_by: string | null;
  reopened_at: string | null;
  status: 'closed' | 'reopened';
  notes: string | null;
};

export type CashSession = {
  id: string;
  business_date: string;
  opening_float: number;
  actual_cash_counted: number | null;
  expected_cash: number | null;
  cash_variance: number | null;
  opened_by: string | null;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  status: 'open' | 'closed';
  notes: string | null;
};

export type AccountReportArchive = {
  id: string;
  report_kind: 'daily' | 'weekly' | 'monthly' | 'annual';
  period_start: string;
  period_end: string;
  title: string;
  file_name: string;
  generated_at: string;
  report_json: Record<string, unknown>;
  generated_by: string | null;
};

export type CompleteSaleResult = {
  sale_id: string;
  sale_number: string;
  total_amount: number;
  updated_stock: Array<{ product_id: string; quantity_on_hand: number }>;
};

export type StockInResult = {
  product_id: string;
  quantity_added: number;
  quantity_on_hand: number;
};

export type Database = {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile> };
      categories: { Row: Category; Insert: Partial<Category>; Update: Partial<Category> };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product> };
      ingredient_items: { Row: IngredientItem; Insert: Partial<IngredientItem>; Update: Partial<IngredientItem> };
      ingredient_balances: { Row: IngredientBalance; Insert: Partial<IngredientBalance>; Update: Partial<IngredientBalance> };
      ingredient_movements: { Row: IngredientMovement; Insert: Partial<IngredientMovement>; Update: Partial<IngredientMovement> };
      recipe_ingredients: { Row: RecipeIngredient; Insert: Partial<RecipeIngredient>; Update: Partial<RecipeIngredient> };
      kitchen_daily_pax: { Row: KitchenDailyPax; Insert: Partial<KitchenDailyPax>; Update: Partial<KitchenDailyPax> };
      kitchen_production_reports: { Row: KitchenProductionReport; Insert: Partial<KitchenProductionReport>; Update: Partial<KitchenProductionReport> };
      kitchen_production_items: { Row: KitchenProductionItem; Insert: Partial<KitchenProductionItem>; Update: Partial<KitchenProductionItem> };
      inventory_balances: {
        Row: InventoryBalance;
        Insert: Partial<InventoryBalance>;
        Update: Partial<InventoryBalance>;
      };
      sales: { Row: Sale; Insert: Partial<Sale>; Update: Partial<Sale> };
      sale_items: { Row: SaleItem; Insert: Partial<SaleItem>; Update: Partial<SaleItem> };
      stock_movements: {
        Row: StockMovement;
        Insert: Partial<StockMovement>;
        Update: Partial<StockMovement>;
      };
      stock_in_drafts: {
        Row: StockInDraftRecord;
        Insert: Partial<StockInDraftRecord>;
        Update: Partial<StockInDraftRecord>;
      };
      cash_sessions: { Row: CashSession; Insert: Partial<CashSession>; Update: Partial<CashSession> };
      daily_reports: { Row: DailyReport; Insert: Partial<DailyReport>; Update: Partial<DailyReport> };
      account_report_archives: { Row: AccountReportArchive; Insert: Partial<AccountReportArchive>; Update: Partial<AccountReportArchive> };
      app_settings: {
        Row: { key: AppSettingKey; value: unknown; updated_by: string | null; updated_at: string };
        Insert: { key: AppSettingKey; value: unknown; updated_by?: string | null };
        Update: { value?: unknown; updated_by?: string | null; updated_at?: string };
      };
    };
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: DbRole };
      verify_app_access: { Args: { p_access_code: string }; Returns: Profile };
      verify_admin_access: { Args: { p_admin_password: string }; Returns: Profile };
      get_business_date: { Args: Record<string, never>; Returns: string };
      stock_in_product: {
        Args: {
          p_product_id: string;
          p_quantity: number;
          p_unit: 'can' | 'carton';
          p_cost_per_unit?: number | null;
          p_supplier?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
          p_entered_by?: string | null;
        };
        Returns: StockInResult;
      };
      stock_in_products: {
        Args: {
          p_entries: Array<{
            product_id: string;
            quantity: number;
            unit: 'can' | 'carton';
            cost_per_unit?: number | null;
            supplier?: string | null;
            reference?: string | null;
            notes?: string | null;
            entered_by?: string | null;
          }>;
        };
        Returns: StockInResult[];
      };
      create_stock_in_draft: {
        Args: {
          p_entries: StockInDraftEntry[];
          p_entered_by?: string | null;
          p_supplier?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
        };
        Returns: StockInDraftRecord;
      };
      confirm_stock_in_draft: {
        Args: {
          p_draft_id: string;
        };
        Returns: { draft: StockInDraftRecord; results: StockInResult[] };
      };
      cancel_stock_in_draft: {
        Args: {
          p_draft_id: string;
          p_reason: string;
        };
        Returns: StockInDraftRecord;
      };
      complete_sale: {
        Args: {
          p_items: Array<{
            product_id: string | null;
            name?: string;
            quantity: number;
            custom_price?: number | null;
            bundle?: boolean;
            components?: Array<{ product_id: string; quantity: number }>;
          }>;
          p_payment_method: PaymentMethod;
          p_qr_reference?: string | null;
          p_qr_receipt_image_path?: string | null;
          p_complimentary_reason?: string | null;
          p_discount_amount?: number | null;
          p_order_taken_by?: string | null;
          p_table_number?: string | null;
        };
        Returns: CompleteSaleResult;
      };
      stock_in_ingredient: {
        Args: {
          p_ingredient_id: string;
          p_input_quantity: number;
          p_unit_type: 'base' | 'pack';
          p_pack_size?: number | null;
          p_supplier?: string | null;
          p_reference?: string | null;
          p_notes?: string | null;
          p_entered_by?: string | null;
        };
        Returns: { ingredient_id: string; quantity_added: number; quantity_on_hand: number };
      };
      adjust_ingredient_stock: {
        Args: {
          p_ingredient_id: string;
          p_movement_type: 'count' | 'waste' | 'adjustment';
          p_quantity: number;
          p_reason: string;
          p_notes?: string | null;
          p_entered_by?: string | null;
        };
        Returns: { ingredient_id: string; quantity_change: number; quantity_on_hand: number };
      };
      save_product_recipe: {
        Args: {
          p_product_id: string;
          p_items: Array<{ ingredient_id: string; quantity_per_unit: number }>;
        };
        Returns: RecipeIngredient[];
      };
      complete_sale_with_qr_type: {
        Args: {
          p_items: Array<{
            product_id: string | null;
            name?: string;
            quantity: number;
            custom_price?: number | null;
            bundle?: boolean;
            components?: Array<{ product_id: string; quantity: number }>;
          }>;
          p_payment_method: PaymentMethod;
          p_qr_reference?: string | null;
          p_qr_receipt_image_path?: string | null;
          p_qr_payment_type?: string | null;
          p_complimentary_reason?: string | null;
          p_discount_amount?: number | null;
          p_order_taken_by?: string | null;
          p_table_number?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: CompleteSaleResult;
      };
      void_sale: { Args: { p_sale_id: string; p_reason: string }; Returns: Sale };
      verify_qr_payment: {
        Args: { p_sale_id: string; p_status: 'verified' | 'mismatch'; p_notes?: string | null };
        Returns: Sale;
      };
      close_daily_report: {
        Args: { p_business_date: string; p_actual_cash_counted: number; p_notes?: string | null };
        Returns: DailyReport;
      };
      reopen_daily_report: {
        Args: { p_business_date: string; p_reason?: string | null };
        Returns: DailyReport;
      };
      generate_account_report_archive: {
        Args: {
          p_report_kind: 'daily' | 'weekly' | 'monthly' | 'annual';
          p_period_start: string;
          p_period_end: string;
        };
        Returns: AccountReportArchive;
      };
      refresh_due_account_report_archives: {
        Args: Record<string, never>;
        Returns: AccountReportArchive[];
      };
      save_kitchen_pax: {
        Args: {
          p_business_date: string;
          p_pax_count: number;
          p_entered_by?: string | null;
          p_notes?: string | null;
        };
        Returns: KitchenDailyPax;
      };
      submit_kitchen_production: {
        Args: {
          p_business_date: string;
          p_platter_name: string;
          p_platter_count: number;
          p_submitted_by?: string | null;
          p_items: Array<{ ingredient_id: string; quantity_per_platter: number; notes?: string | null }>;
          p_serving_basis?: 'pax' | 'table' | 'batch';
          p_notes?: string | null;
        };
        Returns: KitchenProductionReport;
      };
    };
  };
};
