export type Role = 'cashier' | 'manager' | 'admin';
export type PaymentMethod = 'cash' | 'qr' | 'complimentary';
export type QrStatus = 'not_applicable' | 'pending' | 'verified' | 'mismatch';

export type Profile = {
  id: string;
  full_name: string | null;
  role: Role;
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
  | 'receipt_footer_text';

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
      daily_reports: { Row: DailyReport; Insert: Partial<DailyReport>; Update: Partial<DailyReport> };
      app_settings: {
        Row: { key: AppSettingKey; value: unknown; updated_by: string | null; updated_at: string };
        Insert: { key: AppSettingKey; value: unknown; updated_by?: string | null };
        Update: { value?: unknown; updated_by?: string | null; updated_at?: string };
      };
    };
    Functions: {
      current_user_role: { Args: Record<string, never>; Returns: Role };
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
      complete_sale: {
        Args: {
          p_items: Array<{ product_id: string | null; name?: string; quantity: number; custom_price?: number | null }>;
          p_payment_method: PaymentMethod;
          p_qr_reference?: string | null;
          p_qr_receipt_image_path?: string | null;
          p_complimentary_reason?: string | null;
          p_discount_amount?: number | null;
          p_order_taken_by?: string | null;
          p_idempotency_key?: string | null;
        };
        Returns: CompleteSaleResult;
      };
      complete_sale_with_qr_type: {
        Args: {
          p_items: Array<{ product_id: string | null; name?: string; quantity: number; custom_price?: number | null }>;
          p_payment_method: PaymentMethod;
          p_qr_reference?: string | null;
          p_qr_receipt_image_path?: string | null;
          p_qr_payment_type?: string | null;
          p_complimentary_reason?: string | null;
          p_discount_amount?: number | null;
          p_order_taken_by?: string | null;
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
    };
  };
};
