export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_evolution_log: {
        Row: {
          agent_id: string
          created_at: string
          decision_id: string | null
          id: string
          outcome: string | null
          pnl: number | null
          reputation_delta: number | null
          vote: string | null
          weight_after: number | null
          weight_before: number | null
        }
        Insert: {
          agent_id: string
          created_at?: string
          decision_id?: string | null
          id?: string
          outcome?: string | null
          pnl?: number | null
          reputation_delta?: number | null
          vote?: string | null
          weight_after?: number | null
          weight_before?: number | null
        }
        Update: {
          agent_id?: string
          created_at?: string
          decision_id?: string | null
          id?: string
          outcome?: string | null
          pnl?: number | null
          reputation_delta?: number | null
          vote?: string | null
          weight_after?: number | null
          weight_before?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_evolution_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_evolution_log_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_performance_history: {
        Row: {
          agent_id: string | null
          agent_name: string
          bad_votes: number
          created_at: string
          drawdown_caused: number
          good_votes: number
          hit_rate: number
          id: string
          profit_simulated: number
          run_id: string
          score: number
        }
        Insert: {
          agent_id?: string | null
          agent_name: string
          bad_votes?: number
          created_at?: string
          drawdown_caused?: number
          good_votes?: number
          hit_rate?: number
          id?: string
          profit_simulated?: number
          run_id: string
          score?: number
        }
        Update: {
          agent_id?: string | null
          agent_name?: string
          bad_votes?: number
          created_at?: string
          drawdown_caused?: number
          good_votes?: number
          hit_rate?: number
          id?: string
          profit_simulated?: number
          run_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_performance_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_performance_history_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_rankings: {
        Row: {
          accuracy: number | null
          agent_id: string
          computed_at: string
          consistency: number | null
          drawdown_caused: number | null
          id: string
          justification_quality: number | null
          period: string
          profit_contribution: number | null
          score: number
          trades_count: number
          veto_precision: number | null
        }
        Insert: {
          accuracy?: number | null
          agent_id: string
          computed_at?: string
          consistency?: number | null
          drawdown_caused?: number | null
          id?: string
          justification_quality?: number | null
          period: string
          profit_contribution?: number | null
          score?: number
          trades_count?: number
          veto_precision?: number | null
        }
        Update: {
          accuracy?: number | null
          agent_id?: string
          computed_at?: string
          consistency?: number | null
          drawdown_caused?: number | null
          id?: string
          justification_quality?: number | null
          period?: string
          profit_contribution?: number | null
          score?: number
          trades_count?: number
          veto_precision?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_rankings_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_reputation: {
        Row: {
          agent_id: string
          consistency: number
          hits: number
          id: string
          max_drawdown: number
          misses: number
          profit_simulated: number
          risk_reward: number
          score: number
          updated_at: string
          weight_current: number
        }
        Insert: {
          agent_id: string
          consistency?: number
          hits?: number
          id?: string
          max_drawdown?: number
          misses?: number
          profit_simulated?: number
          risk_reward?: number
          score?: number
          updated_at?: string
          weight_current?: number
        }
        Update: {
          agent_id?: string
          consistency?: number
          hits?: number
          id?: string
          max_drawdown?: number
          misses?: number
          profit_simulated?: number
          risk_reward?: number
          score?: number
          updated_at?: string
          weight_current?: number
        }
        Relationships: [
          {
            foreignKeyName: "agent_reputation_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_votes: {
        Row: {
          agent_id: string
          confidence: number
          data_used: Json | null
          decision_id: string | null
          has_veto: boolean
          id: string
          justification: string | null
          knowledge_refs: Json | null
          pair: string
          perceived_risk: number | null
          veto_reason: string | null
          vote: string
          voted_at: string
        }
        Insert: {
          agent_id: string
          confidence?: number
          data_used?: Json | null
          decision_id?: string | null
          has_veto?: boolean
          id?: string
          justification?: string | null
          knowledge_refs?: Json | null
          pair: string
          perceived_risk?: number | null
          veto_reason?: string | null
          vote: string
          voted_at?: string
        }
        Update: {
          agent_id?: string
          confidence?: number
          data_used?: Json | null
          decision_id?: string | null
          has_veto?: boolean
          id?: string
          justification?: string | null
          knowledge_refs?: Json | null
          pair?: string
          perceived_risk?: number | null
          veto_reason?: string | null
          vote?: string
          voted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_votes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          active: boolean
          created_at: string
          expert_id: string | null
          id: string
          kind: string
          name: string
          profile: string
          rules: string | null
          strategy_description: string | null
          updated_at: string
          veto_power: boolean
          weight: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          expert_id?: string | null
          id?: string
          kind?: string
          name: string
          profile: string
          rules?: string | null
          strategy_description?: string | null
          updated_at?: string
          veto_power?: boolean
          weight?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          expert_id?: string | null
          id?: string
          kind?: string
          name?: string
          profile?: string
          rules?: string | null
          strategy_description?: string | null
          updated_at?: string
          veto_power?: boolean
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "agents_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          acknowledged: boolean
          created_at: string
          data: Json | null
          id: string
          message: string
          pair: string | null
          severity: string
          type: string
        }
        Insert: {
          acknowledged?: boolean
          created_at?: string
          data?: Json | null
          id?: string
          message: string
          pair?: string | null
          severity?: string
          type: string
        }
        Update: {
          acknowledged?: boolean
          created_at?: string
          data?: Json | null
          id?: string
          message?: string
          pair?: string | null
          severity?: string
          type?: string
        }
        Relationships: []
      }
      approval_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip: string | null
          payload: Json | null
          request_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip?: string | null
          payload?: Json | null
          request_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip?: string | null
          payload?: Json | null
          request_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          created_at: string
          data: Json | null
          id: string
          kind: string
          message: string | null
          position_id: string | null
          request_id: string | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: string
          kind: string
          message?: string | null
          position_id?: string | null
          request_id?: string | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: string
          kind?: string
          message?: string | null
          position_id?: string | null
          request_id?: string | null
        }
        Relationships: []
      }
      audit_reports: {
        Row: {
          classification: string | null
          content: Json
          created_at: string
          id: string
          phase: string
          position_id: string | null
          request_id: string | null
          summary: string | null
        }
        Insert: {
          classification?: string | null
          content?: Json
          created_at?: string
          id?: string
          phase: string
          position_id?: string | null
          request_id?: string | null
          summary?: string | null
        }
        Update: {
          classification?: string | null
          content?: Json
          created_at?: string
          id?: string
          phase?: string
          position_id?: string | null
          request_id?: string | null
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_reports_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "real_positions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_reports_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      automated_trade_audits: {
        Row: {
          automated_trade_id: string | null
          content: string | null
          created_at: string
          decision_chain: Json
          id: string
          phase: string
          summary: string | null
        }
        Insert: {
          automated_trade_id?: string | null
          content?: string | null
          created_at?: string
          decision_chain?: Json
          id?: string
          phase: string
          summary?: string | null
        }
        Update: {
          automated_trade_id?: string | null
          content?: string | null
          created_at?: string
          decision_chain?: Json
          id?: string
          phase?: string
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automated_trade_audits_automated_trade_id_fkey"
            columns: ["automated_trade_id"]
            isOneToOne: false
            referencedRelation: "automated_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      automated_trades: {
        Row: {
          asset_id: string | null
          automation_level: number
          closed_at: string | null
          consensus: number | null
          created_at: string
          entry_price: number
          exit_price: number | null
          exit_reason: string | null
          id: string
          opened_at: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          request_id: string | null
          risk_amount: number | null
          score: number | null
          session_id: string | null
          side: string
          status: string
          stop_loss: number | null
          supervisor_decision: string | null
          take_profit: number | null
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          automation_level?: number
          closed_at?: string | null
          consensus?: number | null
          created_at?: string
          entry_price: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          request_id?: string | null
          risk_amount?: number | null
          score?: number | null
          session_id?: string | null
          side: string
          status?: string
          stop_loss?: number | null
          supervisor_decision?: string | null
          take_profit?: number | null
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          automation_level?: number
          closed_at?: string | null
          consensus?: number | null
          created_at?: string
          entry_price?: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          opened_at?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          request_id?: string | null
          risk_amount?: number | null
          score?: number | null
          session_id?: string | null
          side?: string
          status?: string
          stop_loss?: number | null
          supervisor_decision?: string | null
          take_profit?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "automated_trades_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_trades_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "automated_trades_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_agent_votes: {
        Row: {
          agent_name: string
          confidence: number
          created_at: string
          id: string
          market_data_snapshot: Json | null
          order_id: string | null
          reason: string | null
          user_id: string
          vote: string
        }
        Insert: {
          agent_name: string
          confidence?: number
          created_at?: string
          id?: string
          market_data_snapshot?: Json | null
          order_id?: string | null
          reason?: string | null
          user_id: string
          vote: string
        }
        Update: {
          agent_name?: string
          confidence?: number
          created_at?: string
          id?: string
          market_data_snapshot?: Json | null
          order_id?: string | null
          reason?: string | null
          user_id?: string
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_agent_votes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "b3_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_asset_profiles: {
        Row: {
          active: boolean
          asset_class: string
          base_price_fallback: number
          contract_code: string
          created_at: string
          display_name: string
          fee_model: string
          fee_per_contract_brl: number
          fee_percent_volume: number
          indicator_timeframe: string
          margin_model: string
          margin_per_contract_brl: number
          margin_percent_position: number
          near_resistance_pts: number | null
          price_deviation_limit: number
          quote_symbol: string
          spread_max_price: number
          symbol: string
          tick_size: number
          tick_value_brl: number
          trading_calendar: string
          trend_strength_factor: number | null
          vwap_min_distance_range_ratio: number
          vwap_min_distance_stop_ratio: number
        }
        Insert: {
          active?: boolean
          asset_class: string
          base_price_fallback: number
          contract_code: string
          created_at?: string
          display_name: string
          fee_model?: string
          fee_per_contract_brl?: number
          fee_percent_volume?: number
          indicator_timeframe?: string
          margin_model?: string
          margin_per_contract_brl?: number
          margin_percent_position?: number
          near_resistance_pts?: number | null
          price_deviation_limit?: number
          quote_symbol: string
          spread_max_price?: number
          symbol: string
          tick_size: number
          tick_value_brl: number
          trading_calendar?: string
          trend_strength_factor?: number | null
          vwap_min_distance_range_ratio?: number
          vwap_min_distance_stop_ratio?: number
        }
        Update: {
          active?: boolean
          asset_class?: string
          base_price_fallback?: number
          contract_code?: string
          created_at?: string
          display_name?: string
          fee_model?: string
          fee_per_contract_brl?: number
          fee_percent_volume?: number
          indicator_timeframe?: string
          margin_model?: string
          margin_per_contract_brl?: number
          margin_percent_position?: number
          near_resistance_pts?: number | null
          price_deviation_limit?: number
          quote_symbol?: string
          spread_max_price?: number
          symbol?: string
          tick_size?: number
          tick_value_brl?: number
          trading_calendar?: string
          trend_strength_factor?: number | null
          vwap_min_distance_range_ratio?: number
          vwap_min_distance_stop_ratio?: number
        }
        Relationships: []
      }
      b3_calibracao_semanal: {
        Row: {
          apelido: string | null
          aplicado: boolean
          aplicado_em: string | null
          calculado_em: string
          confiavel: boolean
          dias_afetados: number | null
          ganho_estimado: number | null
          id: string
          mode: string
          motivo: string | null
          mult_atual: number | null
          mult_sugerido: number | null
          peso_top3: number | null
          pregoes: number | null
          resultado_atual: number | null
          resultado_sugerido: number | null
          semana_ref: string
          symbol: string
          variant: string
        }
        Insert: {
          apelido?: string | null
          aplicado?: boolean
          aplicado_em?: string | null
          calculado_em?: string
          confiavel?: boolean
          dias_afetados?: number | null
          ganho_estimado?: number | null
          id?: string
          mode: string
          motivo?: string | null
          mult_atual?: number | null
          mult_sugerido?: number | null
          peso_top3?: number | null
          pregoes?: number | null
          resultado_atual?: number | null
          resultado_sugerido?: number | null
          semana_ref: string
          symbol: string
          variant: string
        }
        Update: {
          apelido?: string | null
          aplicado?: boolean
          aplicado_em?: string | null
          calculado_em?: string
          confiavel?: boolean
          dias_afetados?: number | null
          ganho_estimado?: number | null
          id?: string
          mode?: string
          motivo?: string | null
          mult_atual?: number | null
          mult_sugerido?: number | null
          peso_top3?: number | null
          pregoes?: number | null
          resultado_atual?: number | null
          resultado_sugerido?: number | null
          semana_ref?: string
          symbol?: string
          variant?: string
        }
        Relationships: []
      }
      b3_cenario_horario: {
        Row: {
          aberto_brl: number | null
          ativo: string
          compras: number | null
          dia: string
          gravado_em: string
          hora: number
          mode: string
          pares_invertidos: number | null
          posicionados: number | null
          realizado_brl: number | null
          total_brl: number | null
          user_id: string
          variant: string
          vendas: number | null
        }
        Insert: {
          aberto_brl?: number | null
          ativo: string
          compras?: number | null
          dia: string
          gravado_em?: string
          hora: number
          mode?: string
          pares_invertidos?: number | null
          posicionados?: number | null
          realizado_brl?: number | null
          total_brl?: number | null
          user_id: string
          variant?: string
          vendas?: number | null
        }
        Update: {
          aberto_brl?: number | null
          ativo?: string
          compras?: number | null
          dia?: string
          gravado_em?: string
          hora?: number
          mode?: string
          pares_invertidos?: number | null
          posicionados?: number | null
          realizado_brl?: number | null
          total_brl?: number | null
          user_id?: string
          variant?: string
          vendas?: number | null
        }
        Relationships: []
      }
      b3_daily_protection_history: {
        Row: {
          block_at: string | null
          block_reason: string | null
          created_at: string
          day_key: string
          drawdown_after_target_brl: number | null
          final_status: string | null
          given_back_brl: number | null
          id: string
          mode: string
          peak_profit_after_target_brl: number | null
          profit_after_target_brl: number | null
          profit_at_close_brl: number | null
          profit_at_target_brl: number | null
          simulation_mode_id: string | null
          simulation_run_id: string | null
          target_reached_at: string | null
          trades_after_target: number | null
          trades_total: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          block_at?: string | null
          block_reason?: string | null
          created_at?: string
          day_key: string
          drawdown_after_target_brl?: number | null
          final_status?: string | null
          given_back_brl?: number | null
          id?: string
          mode: string
          peak_profit_after_target_brl?: number | null
          profit_after_target_brl?: number | null
          profit_at_close_brl?: number | null
          profit_at_target_brl?: number | null
          simulation_mode_id?: string | null
          simulation_run_id?: string | null
          target_reached_at?: string | null
          trades_after_target?: number | null
          trades_total?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          block_at?: string | null
          block_reason?: string | null
          created_at?: string
          day_key?: string
          drawdown_after_target_brl?: number | null
          final_status?: string | null
          given_back_brl?: number | null
          id?: string
          mode?: string
          peak_profit_after_target_brl?: number | null
          profit_after_target_brl?: number | null
          profit_at_close_brl?: number | null
          profit_at_target_brl?: number | null
          simulation_mode_id?: string | null
          simulation_run_id?: string | null
          target_reached_at?: string | null
          trades_after_target?: number | null
          trades_total?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_daily_report: {
        Row: {
          closed_positions: number
          created_at: string
          daily_status: string
          fees: number
          gross_result: number
          id: string
          net_result: number
          open_positions: number
          starting_balance: number
          total_bought: number
          total_sold: number
          trade_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_positions?: number
          created_at?: string
          daily_status?: string
          fees?: number
          gross_result?: number
          id?: string
          net_result?: number
          open_positions?: number
          starting_balance?: number
          total_bought?: number
          total_sold?: number
          trade_date?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_positions?: number
          created_at?: string
          daily_status?: string
          fees?: number
          gross_result?: number
          id?: string
          net_result?: number
          open_positions?: number
          starting_balance?: number
          total_bought?: number
          total_sold?: number
          trade_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_diagnostico_dia: {
        Row: {
          acertos: number | null
          diagnostico: string[] | null
          estouro_stop_medio: number | null
          gerado_em: string
          minutos_ate_ultima_op: number | null
          mode: string
          ops: number | null
          primeira_hora_brl: number | null
          resto_do_dia_brl: number | null
          resultado_brl: number | null
          robos_no_sinal_medio: number | null
          saidas: Json | null
          score_medio: number | null
          stop_brl_config: number | null
          stop_pts_config: number | null
          symbol: string
          trade_date: string
          variant: string
        }
        Insert: {
          acertos?: number | null
          diagnostico?: string[] | null
          estouro_stop_medio?: number | null
          gerado_em?: string
          minutos_ate_ultima_op?: number | null
          mode: string
          ops?: number | null
          primeira_hora_brl?: number | null
          resto_do_dia_brl?: number | null
          resultado_brl?: number | null
          robos_no_sinal_medio?: number | null
          saidas?: Json | null
          score_medio?: number | null
          stop_brl_config?: number | null
          stop_pts_config?: number | null
          symbol: string
          trade_date: string
          variant: string
        }
        Update: {
          acertos?: number | null
          diagnostico?: string[] | null
          estouro_stop_medio?: number | null
          gerado_em?: string
          minutos_ate_ultima_op?: number | null
          mode?: string
          ops?: number | null
          primeira_hora_brl?: number | null
          resto_do_dia_brl?: number | null
          resultado_brl?: number | null
          robos_no_sinal_medio?: number | null
          saidas?: Json | null
          score_medio?: number | null
          stop_brl_config?: number | null
          stop_pts_config?: number | null
          symbol?: string
          trade_date?: string
          variant?: string
        }
        Relationships: []
      }
      b3_engine_state: {
        Row: {
          counters: Json
          created_at: string
          engine_audit: Json
          id: string
          last_snapshot_id: string | null
          market_time: string | null
          simulation_run_id: string
          symbol: string | null
          tick_guard: Json | null
          trade_date: string | null
          updated_at: string
          user_id: string
          variant: string | null
          write_sigs: Json
        }
        Insert: {
          counters?: Json
          created_at?: string
          engine_audit?: Json
          id?: string
          last_snapshot_id?: string | null
          market_time?: string | null
          simulation_run_id: string
          symbol?: string | null
          tick_guard?: Json | null
          trade_date?: string | null
          updated_at?: string
          user_id: string
          variant?: string | null
          write_sigs?: Json
        }
        Update: {
          counters?: Json
          created_at?: string
          engine_audit?: Json
          id?: string
          last_snapshot_id?: string | null
          market_time?: string | null
          simulation_run_id?: string
          symbol?: string | null
          tick_guard?: Json | null
          trade_date?: string | null
          updated_at?: string
          user_id?: string
          variant?: string | null
          write_sigs?: Json
        }
        Relationships: [
          {
            foreignKeyName: "b3_engine_state_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_engine_state_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_entry_decision_log: {
        Row: {
          approve_votes: number | null
          confidence: number | null
          created_at: string
          detalhe: Json | null
          entry_style: string | null
          estagio: string
          id: string
          mode: string
          motivo: string | null
          score: number | null
          simulation_mode_id: string | null
          simulation_run_id: string | null
          symbol: string
          trade_date: string
          user_id: string
        }
        Insert: {
          approve_votes?: number | null
          confidence?: number | null
          created_at?: string
          detalhe?: Json | null
          entry_style?: string | null
          estagio: string
          id?: string
          mode: string
          motivo?: string | null
          score?: number | null
          simulation_mode_id?: string | null
          simulation_run_id?: string | null
          symbol: string
          trade_date?: string
          user_id: string
        }
        Update: {
          approve_votes?: number | null
          confidence?: number | null
          created_at?: string
          detalhe?: Json | null
          entry_style?: string | null
          estagio?: string
          id?: string
          mode?: string
          motivo?: string | null
          score?: number | null
          simulation_mode_id?: string | null
          simulation_run_id?: string | null
          symbol?: string
          trade_date?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_executor_heartbeat: {
        Row: {
          detalhe: Json
          env: string
          hostname: string | null
          iniciado_em: string
          instance_id: string
          pid: number | null
          ultimo_batimento: string
          user_id: string | null
          versao: string | null
        }
        Insert: {
          detalhe?: Json
          env?: string
          hostname?: string | null
          iniciado_em?: string
          instance_id: string
          pid?: number | null
          ultimo_batimento?: string
          user_id?: string | null
          versao?: string | null
        }
        Update: {
          detalhe?: Json
          env?: string
          hostname?: string | null
          iniciado_em?: string
          instance_id?: string
          pid?: number | null
          ultimo_batimento?: string
          user_id?: string | null
          versao?: string | null
        }
        Relationships: []
      }
      b3_grupo_estado_dia: {
        Row: {
          multiplicador: number
          nivel_atual: number
          pior_do_dia_brl: number
          resultado_brl: number
          robos_travados: string[]
          symbol: string
          trade_date: string
          ultima_mudanca_ts: string | null
          user_id: string
          variant: string
        }
        Insert: {
          multiplicador?: number
          nivel_atual?: number
          pior_do_dia_brl?: number
          resultado_brl?: number
          robos_travados?: string[]
          symbol: string
          trade_date: string
          ultima_mudanca_ts?: string | null
          user_id: string
          variant: string
        }
        Update: {
          multiplicador?: number
          nivel_atual?: number
          pior_do_dia_brl?: number
          resultado_brl?: number
          robos_travados?: string[]
          symbol?: string
          trade_date?: string
          ultima_mudanca_ts?: string | null
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_grupo_limites: {
        Row: {
          ativo: boolean
          criado_em: string
          dwell_minutos: number
          fator_contratos: number
          histerese_pct: number
          nivel1_pct: number
          nivel2_pct: number
          nivel3_pct: number
          nivel4_pct: number
          notas: string | null
          symbol: string
          teto_brl: number
          teto_pct: number
          user_id: string
          variant: string
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          dwell_minutos?: number
          fator_contratos?: number
          histerese_pct?: number
          nivel1_pct?: number
          nivel2_pct?: number
          nivel3_pct?: number
          nivel4_pct?: number
          notas?: string | null
          symbol: string
          teto_brl: number
          teto_pct?: number
          user_id: string
          variant: string
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          dwell_minutos?: number
          fator_contratos?: number
          histerese_pct?: number
          nivel1_pct?: number
          nivel2_pct?: number
          nivel3_pct?: number
          nivel4_pct?: number
          notas?: string | null
          symbol?: string
          teto_brl?: number
          teto_pct?: number
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_grupo_sombra_dia: {
        Row: {
          created_at: string
          diferenca_brl: number
          id: string
          mode: string
          ops_livre: number
          ops_sombra: number
          resultado_livre_brl: number
          resultado_sombra_brl: number
          sombra_por_freio: Json
          symbol: string
          trade_date: string
          updated_at: string
          user_id: string
          variant: string
        }
        Insert: {
          created_at?: string
          diferenca_brl?: number
          id?: string
          mode?: string
          ops_livre?: number
          ops_sombra?: number
          resultado_livre_brl?: number
          resultado_sombra_brl?: number
          sombra_por_freio?: Json
          symbol: string
          trade_date: string
          updated_at?: string
          user_id: string
          variant: string
        }
        Update: {
          created_at?: string
          diferenca_brl?: number
          id?: string
          mode?: string
          ops_livre?: number
          ops_sombra?: number
          resultado_livre_brl?: number
          resultado_sombra_brl?: number
          sombra_por_freio?: Json
          symbol?: string
          trade_date?: string
          updated_at?: string
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_intervencoes: {
        Row: {
          acao: string
          ambiente: string
          anula_dia: boolean
          id: string
          limite_vigente: number | null
          mode: string
          motivo: string
          origem: string
          pnl_no_momento: number | null
          symbol: string
          trade_date: string
          ts: string
          user_id: string
          variant: string
        }
        Insert: {
          acao: string
          ambiente?: string
          anula_dia?: boolean
          id?: string
          limite_vigente?: number | null
          mode: string
          motivo: string
          origem?: string
          pnl_no_momento?: number | null
          symbol: string
          trade_date: string
          ts?: string
          user_id: string
          variant: string
        }
        Update: {
          acao?: string
          ambiente?: string
          anula_dia?: boolean
          id?: string
          limite_vigente?: number | null
          mode?: string
          motivo?: string
          origem?: string
          pnl_no_momento?: number | null
          symbol?: string
          trade_date?: string
          ts?: string
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_legacy_mt5_candles: {
        Row: {
          close: number
          high: number
          id: string
          low: number
          minute_ts: string
          open: number
          server: string | null
          symbol: string
          tick_count: number
          updated_at: string
          user_id: string
          volume: number
        }
        Insert: {
          close: number
          high: number
          id?: string
          low: number
          minute_ts: string
          open: number
          server?: string | null
          symbol: string
          tick_count?: number
          updated_at?: string
          user_id: string
          volume?: number
        }
        Update: {
          close?: number
          high?: number
          id?: string
          low?: number
          minute_ts?: string
          open?: number
          server?: string | null
          symbol?: string
          tick_count?: number
          updated_at?: string
          user_id?: string
          volume?: number
        }
        Relationships: []
      }
      b3_legacy_mt5_signals: {
        Row: {
          blocked_reason: string | null
          decision: string
          id: string
          intended_side: string
          mode: string
          price_ask: number | null
          price_bid: number | null
          price_last: number | null
          reason: string | null
          score: number | null
          server: string | null
          spread: number | null
          symbol: string
          tick_age_s: number | null
          ts: string
          user_id: string
          votes: Json | null
        }
        Insert: {
          blocked_reason?: string | null
          decision: string
          id?: string
          intended_side: string
          mode: string
          price_ask?: number | null
          price_bid?: number | null
          price_last?: number | null
          reason?: string | null
          score?: number | null
          server?: string | null
          spread?: number | null
          symbol: string
          tick_age_s?: number | null
          ts?: string
          user_id: string
          votes?: Json | null
        }
        Update: {
          blocked_reason?: string | null
          decision?: string
          id?: string
          intended_side?: string
          mode?: string
          price_ask?: number | null
          price_bid?: number | null
          price_last?: number | null
          reason?: string | null
          score?: number | null
          server?: string | null
          spread?: number | null
          symbol?: string
          tick_age_s?: number | null
          ts?: string
          user_id?: string
          votes?: Json | null
        }
        Relationships: []
      }
      b3_legacy_mt5_trades: {
        Row: {
          close_reason: string | null
          closed_at: string | null
          created_at: string
          entry_ask: number | null
          entry_bid: number | null
          entry_price: number
          exit_ask: number | null
          exit_bid: number | null
          exit_price: number | null
          fees_brl: number | null
          gain_pts: number | null
          gross_brl: number | null
          gross_pts: number | null
          id: string
          legacy_mode_snapshot: Json | null
          legacy_signal_id: string | null
          mode: string
          net_brl: number | null
          opened_at: string
          quantity: number
          quote_server: string | null
          side: string
          slippage_pts: number | null
          source_engine: string
          status: string
          stop_pts: number | null
          symbol: string
          user_id: string
        }
        Insert: {
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          entry_ask?: number | null
          entry_bid?: number | null
          entry_price: number
          exit_ask?: number | null
          exit_bid?: number | null
          exit_price?: number | null
          fees_brl?: number | null
          gain_pts?: number | null
          gross_brl?: number | null
          gross_pts?: number | null
          id?: string
          legacy_mode_snapshot?: Json | null
          legacy_signal_id?: string | null
          mode: string
          net_brl?: number | null
          opened_at?: string
          quantity?: number
          quote_server?: string | null
          side: string
          slippage_pts?: number | null
          source_engine?: string
          status?: string
          stop_pts?: number | null
          symbol: string
          user_id: string
        }
        Update: {
          close_reason?: string | null
          closed_at?: string | null
          created_at?: string
          entry_ask?: number | null
          entry_bid?: number | null
          entry_price?: number
          exit_ask?: number | null
          exit_bid?: number | null
          exit_price?: number | null
          fees_brl?: number | null
          gain_pts?: number | null
          gross_brl?: number | null
          gross_pts?: number | null
          id?: string
          legacy_mode_snapshot?: Json | null
          legacy_signal_id?: string | null
          mode?: string
          net_brl?: number | null
          opened_at?: string
          quantity?: number
          quote_server?: string | null
          side?: string
          slippage_pts?: number | null
          source_engine?: string
          status?: string
          stop_pts?: number | null
          symbol?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_live_orders: {
        Row: {
          broker_ticket_entry: string | null
          broker_ticket_exit: string | null
          command_id: string | null
          created_at: string
          divergencias_leituras: number
          entry_price: number | null
          entry_time: string | null
          exit_price: number | null
          exit_time: string | null
          fees_brl: number | null
          gain_pts: number | null
          gross_result_brl: number | null
          id: string
          instance_id: string | null
          liberacao_manual: boolean
          magic_number: number
          mode: string | null
          net_result_brl: number | null
          quantity: number
          side: string
          simulation_run_id: string | null
          status: string
          stop_price: number | null
          stop_pts: number | null
          symbol: string
          target_price: number | null
          updated_at: string
          user_id: string
          variant: string
        }
        Insert: {
          broker_ticket_entry?: string | null
          broker_ticket_exit?: string | null
          command_id?: string | null
          created_at?: string
          divergencias_leituras?: number
          entry_price?: number | null
          entry_time?: string | null
          exit_price?: number | null
          exit_time?: string | null
          fees_brl?: number | null
          gain_pts?: number | null
          gross_result_brl?: number | null
          id?: string
          instance_id?: string | null
          liberacao_manual?: boolean
          magic_number: number
          mode?: string | null
          net_result_brl?: number | null
          quantity: number
          side: string
          simulation_run_id?: string | null
          status?: string
          stop_price?: number | null
          stop_pts?: number | null
          symbol: string
          target_price?: number | null
          updated_at?: string
          user_id: string
          variant?: string
        }
        Update: {
          broker_ticket_entry?: string | null
          broker_ticket_exit?: string | null
          command_id?: string | null
          created_at?: string
          divergencias_leituras?: number
          entry_price?: number | null
          entry_time?: string | null
          exit_price?: number | null
          exit_time?: string | null
          fees_brl?: number | null
          gain_pts?: number | null
          gross_result_brl?: number | null
          id?: string
          instance_id?: string | null
          liberacao_manual?: boolean
          magic_number?: number
          mode?: string | null
          net_result_brl?: number | null
          quantity?: number
          side?: string
          simulation_run_id?: string | null
          status?: string
          stop_price?: number | null
          stop_pts?: number | null
          symbol?: string
          target_price?: number | null
          updated_at?: string
          user_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_live_orders_command_id_fkey"
            columns: ["command_id"]
            isOneToOne: false
            referencedRelation: "b3_mt5_commands"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_live_orders_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_live_orders_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_livro_mudancas: {
        Row: {
          aplicada_em: string
          autor: string
          avaliado_em: string | null
          avaliar_em: string | null
          como_reverter: string | null
          criado_em: string
          escopo: string
          evidencia: string | null
          id: string
          mode: string | null
          o_que: string
          por_que: string
          resultado: string | null
          status: string
          symbol: string | null
          valor_antes: string | null
          valor_depois: string | null
          variant: string | null
        }
        Insert: {
          aplicada_em: string
          autor: string
          avaliado_em?: string | null
          avaliar_em?: string | null
          como_reverter?: string | null
          criado_em?: string
          escopo: string
          evidencia?: string | null
          id?: string
          mode?: string | null
          o_que: string
          por_que: string
          resultado?: string | null
          status?: string
          symbol?: string | null
          valor_antes?: string | null
          valor_depois?: string | null
          variant?: string | null
        }
        Update: {
          aplicada_em?: string
          autor?: string
          avaliado_em?: string | null
          avaliar_em?: string | null
          como_reverter?: string | null
          criado_em?: string
          escopo?: string
          evidencia?: string | null
          id?: string
          mode?: string | null
          o_que?: string
          por_que?: string
          resultado?: string | null
          status?: string
          symbol?: string | null
          valor_antes?: string | null
          valor_depois?: string | null
          variant?: string | null
        }
        Relationships: []
      }
      b3_m1_candles_hist: {
        Row: {
          candle_close: number
          candle_high: number
          candle_low: number
          candle_open: number
          minute_ts: string
          symbol: string
          ticks: number
          user_id: string
          volume: number
        }
        Insert: {
          candle_close: number
          candle_high: number
          candle_low: number
          candle_open: number
          minute_ts: string
          symbol: string
          ticks?: number
          user_id: string
          volume?: number
        }
        Update: {
          candle_close?: number
          candle_high?: number
          candle_low?: number
          candle_open?: number
          minute_ts?: string
          symbol?: string
          ticks?: number
          user_id?: string
          volume?: number
        }
        Relationships: []
      }
      b3_macro_events: {
        Row: {
          active: boolean
          block_end: string
          block_start: string
          category: string
          created_at: string
          id: string
          name: string
          notes: string | null
          severity: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          block_end: string
          block_start: string
          category?: string
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          severity?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          block_end?: string
          block_start?: string
          category?: string
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          severity?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_manual_sistema: {
        Row: {
          area: string
          armadilha: string | null
          atualizado_em: string
          como_verificar: string | null
          descoberto_em: string | null
          gravidade: string
          id: number
          o_que_e: string
          titulo: string
        }
        Insert: {
          area: string
          armadilha?: string | null
          atualizado_em?: string
          como_verificar?: string | null
          descoberto_em?: string | null
          gravidade?: string
          id?: number
          o_que_e: string
          titulo: string
        }
        Update: {
          area?: string
          armadilha?: string | null
          atualizado_em?: string
          como_verificar?: string | null
          descoberto_em?: string | null
          gravidade?: string
          id?: number
          o_que_e?: string
          titulo?: string
        }
        Relationships: []
      }
      b3_mode_apelidos: {
        Row: {
          apelido: string
          criado_em: string
          mode: string
          observacao: string | null
          ordem: number
          rotulo_tecnico: string
        }
        Insert: {
          apelido: string
          criado_em?: string
          mode: string
          observacao?: string | null
          ordem: number
          rotulo_tecnico: string
        }
        Update: {
          apelido?: string
          criado_em?: string
          mode?: string
          observacao?: string | null
          ordem?: number
          rotulo_tecnico?: string
        }
        Relationships: []
      }
      b3_mode_user_defaults: {
        Row: {
          consecutive_loss_after_target: number | null
          daily_gain_target_brl: number | null
          daily_loss_limit_brl: number | null
          entry_cutoff_time: string | null
          force_close_time: string | null
          gain_pts: number | null
          max_contracts: number | null
          max_volatility_pct: number | null
          min_approve_votes: number | null
          min_confidence: number | null
          min_score: number | null
          minimum_operating_minutes: number | null
          minimum_trades_before_profit_lock: number | null
          mode: string
          post_target_allowed_retracement: number | null
          post_target_size_reduction: number | null
          profit_multiplier_before_lock: number | null
          stop_pts: number | null
          symbol: string
          trading_start_time: string | null
          trailing_activation_pts: number | null
          trailing_giveback_pts: number | null
          trailing_mode: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          consecutive_loss_after_target?: number | null
          daily_gain_target_brl?: number | null
          daily_loss_limit_brl?: number | null
          entry_cutoff_time?: string | null
          force_close_time?: string | null
          gain_pts?: number | null
          max_contracts?: number | null
          max_volatility_pct?: number | null
          min_approve_votes?: number | null
          min_confidence?: number | null
          min_score?: number | null
          minimum_operating_minutes?: number | null
          minimum_trades_before_profit_lock?: number | null
          mode: string
          post_target_allowed_retracement?: number | null
          post_target_size_reduction?: number | null
          profit_multiplier_before_lock?: number | null
          stop_pts?: number | null
          symbol?: string
          trading_start_time?: string | null
          trailing_activation_pts?: number | null
          trailing_giveback_pts?: number | null
          trailing_mode?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          consecutive_loss_after_target?: number | null
          daily_gain_target_brl?: number | null
          daily_loss_limit_brl?: number | null
          entry_cutoff_time?: string | null
          force_close_time?: string | null
          gain_pts?: number | null
          max_contracts?: number | null
          max_volatility_pct?: number | null
          min_approve_votes?: number | null
          min_confidence?: number | null
          min_score?: number | null
          minimum_operating_minutes?: number | null
          minimum_trades_before_profit_lock?: number | null
          mode?: string
          post_target_allowed_retracement?: number | null
          post_target_size_reduction?: number | null
          profit_multiplier_before_lock?: number | null
          stop_pts?: number | null
          symbol?: string
          trading_start_time?: string | null
          trailing_activation_pts?: number | null
          trailing_giveback_pts?: number | null
          trailing_mode?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_mt5_account_state: {
        Row: {
          account_login: string | null
          capital_aceito: number | null
          capital_liquido: number | null
          capital_pendente: number | null
          capital_pendente_leituras: number
          env: string | null
          fechamentos: Json | null
          margem_livre: number | null
          modo_conta: string | null
          negociacao_permitida: boolean | null
          posicoes: Json
          reportado_em: string
          saldo: number | null
          server_name: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_login?: string | null
          capital_aceito?: number | null
          capital_liquido?: number | null
          capital_pendente?: number | null
          capital_pendente_leituras?: number
          env?: string | null
          fechamentos?: Json | null
          margem_livre?: number | null
          modo_conta?: string | null
          negociacao_permitida?: boolean | null
          posicoes?: Json
          reportado_em?: string
          saldo?: number | null
          server_name?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_login?: string | null
          capital_aceito?: number | null
          capital_liquido?: number | null
          capital_pendente?: number | null
          capital_pendente_leituras?: number
          env?: string | null
          fechamentos?: Json | null
          margem_livre?: number | null
          modo_conta?: string | null
          negociacao_permitida?: boolean | null
          posicoes?: Json
          reportado_em?: string
          saldo?: number | null
          server_name?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_mt5_commands: {
        Row: {
          action: string
          broker_position_ticket: string | null
          broker_ticket: string | null
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          env: string
          error_message: string | null
          expires_at: string
          filled_at: string | null
          filled_price: number | null
          gain_pts: number | null
          id: string
          idempotency_key: string
          instance_id: string | null
          liberacao_manual: boolean
          magic_number: number
          mode: string | null
          quantity: number
          requested_by: string
          side: string | null
          simulation_run_id: string | null
          status: string
          stop_price: number | null
          stop_pts: number | null
          symbol: string
          target_price: number | null
          user_id: string
          variant: string
        }
        Insert: {
          action: string
          broker_position_ticket?: string | null
          broker_ticket?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          env: string
          error_message?: string | null
          expires_at?: string
          filled_at?: string | null
          filled_price?: number | null
          gain_pts?: number | null
          id?: string
          idempotency_key: string
          instance_id?: string | null
          liberacao_manual?: boolean
          magic_number: number
          mode?: string | null
          quantity: number
          requested_by: string
          side?: string | null
          simulation_run_id?: string | null
          status?: string
          stop_price?: number | null
          stop_pts?: number | null
          symbol: string
          target_price?: number | null
          user_id: string
          variant?: string
        }
        Update: {
          action?: string
          broker_position_ticket?: string | null
          broker_ticket?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          env?: string
          error_message?: string | null
          expires_at?: string
          filled_at?: string | null
          filled_price?: number | null
          gain_pts?: number | null
          id?: string
          idempotency_key?: string
          instance_id?: string | null
          liberacao_manual?: boolean
          magic_number?: number
          mode?: string | null
          quantity?: number
          requested_by?: string
          side?: string | null
          simulation_run_id?: string | null
          status?: string
          stop_price?: number | null
          stop_pts?: number | null
          symbol?: string
          target_price?: number | null
          user_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_mt5_commands_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_mt5_commands_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_mt5sim_blocks: {
        Row: {
          id: string
          limit_value: number | null
          lock_kind: string
          observed: number | null
          reason: string | null
          robot_id: string | null
          signal_id: string | null
          ts: string
          user_id: string
        }
        Insert: {
          id?: string
          limit_value?: number | null
          lock_kind: string
          observed?: number | null
          reason?: string | null
          robot_id?: string | null
          signal_id?: string | null
          ts?: string
          user_id: string
        }
        Update: {
          id?: string
          limit_value?: number | null
          lock_kind?: string
          observed?: number | null
          reason?: string | null
          robot_id?: string | null
          signal_id?: string | null
          ts?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_mt5sim_blocks_robot_id_fkey"
            columns: ["robot_id"]
            isOneToOne: false
            referencedRelation: "b3_mt5sim_robots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_mt5sim_blocks_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "b3_mt5sim_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_mt5sim_conflicts: {
        Row: {
          id: string
          outcome: Json | null
          prices: Json
          robots: Json
          sides: Json
          ts: string
          user_id: string
        }
        Insert: {
          id?: string
          outcome?: Json | null
          prices: Json
          robots: Json
          sides: Json
          ts?: string
          user_id: string
        }
        Update: {
          id?: string
          outcome?: Json | null
          prices?: Json
          robots?: Json
          sides?: Json
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_mt5sim_manual_trades: {
        Row: {
          created_at: string
          entry_reason: string | null
          exit_reason: string | null
          fees_brl: number | null
          gross_brl: number | null
          id: string
          linked_trade_id: string | null
          net_brl: number | null
          points_result: number | null
          price_entry: number
          price_exit: number | null
          side: string
          status: string
          symbol: string
          ts_entry: string
          ts_exit: string | null
          updated_at: string
          user_id: string
          volume: number
        }
        Insert: {
          created_at?: string
          entry_reason?: string | null
          exit_reason?: string | null
          fees_brl?: number | null
          gross_brl?: number | null
          id?: string
          linked_trade_id?: string | null
          net_brl?: number | null
          points_result?: number | null
          price_entry: number
          price_exit?: number | null
          side: string
          status?: string
          symbol?: string
          ts_entry?: string
          ts_exit?: string | null
          updated_at?: string
          user_id: string
          volume: number
        }
        Update: {
          created_at?: string
          entry_reason?: string | null
          exit_reason?: string | null
          fees_brl?: number | null
          gross_brl?: number | null
          id?: string
          linked_trade_id?: string | null
          net_brl?: number | null
          points_result?: number | null
          price_entry?: number
          price_exit?: number | null
          side?: string
          status?: string
          symbol?: string
          ts_entry?: string
          ts_exit?: string | null
          updated_at?: string
          user_id?: string
          volume?: number
        }
        Relationships: []
      }
      b3_mt5sim_order_attempts: {
        Row: {
          action: string
          blocked: boolean
          id: string
          message: string | null
          payload: Json | null
          source: string
          ts: string
          user_id: string
        }
        Insert: {
          action: string
          blocked?: boolean
          id?: string
          message?: string | null
          payload?: Json | null
          source: string
          ts?: string
          user_id: string
        }
        Update: {
          action?: string
          blocked?: boolean
          id?: string
          message?: string | null
          payload?: Json | null
          source?: string
          ts?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_mt5sim_quotes: {
        Row: {
          account_masked: string | null
          ask: number | null
          bid: number | null
          id: number
          last: number | null
          mt5_connected: boolean | null
          received_at: string
          server: string | null
          spread: number | null
          symbol: string
          symbol_status: string | null
          tick_ts: string
          user_id: string
          volume: number | null
        }
        Insert: {
          account_masked?: string | null
          ask?: number | null
          bid?: number | null
          id?: number
          last?: number | null
          mt5_connected?: boolean | null
          received_at?: string
          server?: string | null
          spread?: number | null
          symbol: string
          symbol_status?: string | null
          tick_ts: string
          user_id: string
          volume?: number | null
        }
        Update: {
          account_masked?: string | null
          ask?: number | null
          bid?: number | null
          id?: number
          last?: number | null
          mt5_connected?: boolean | null
          received_at?: string
          server?: string | null
          spread?: number | null
          symbol?: string
          symbol_status?: string | null
          tick_ts?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: []
      }
      b3_mt5sim_robots: {
        Row: {
          breakeven_trigger_pts: number
          cooldown_s: number
          cooldown_until: string | null
          created_at: string
          daily_gain_limit_brl: number
          daily_loss_limit_brl: number
          enabled: boolean
          exit_mode: string
          id: string
          initial_balance_brl: number
          max_consec_losses: number
          max_drawdown_brl: number
          max_duration_s: number
          max_spread_ticks: number
          max_trades_day: number
          min_score: number
          mode: string
          profile: string
          signal_ttl_s: number
          stop_loss_points: number
          strategy_params: Json
          take_profit_points: number
          trailing_start_pts: number
          trailing_step_pts: number
          updated_at: string
          user_id: string
          volume: number
        }
        Insert: {
          breakeven_trigger_pts?: number
          cooldown_s?: number
          cooldown_until?: string | null
          created_at?: string
          daily_gain_limit_brl?: number
          daily_loss_limit_brl?: number
          enabled?: boolean
          exit_mode?: string
          id?: string
          initial_balance_brl?: number
          max_consec_losses?: number
          max_drawdown_brl?: number
          max_duration_s?: number
          max_spread_ticks?: number
          max_trades_day?: number
          min_score?: number
          mode?: string
          profile: string
          signal_ttl_s?: number
          stop_loss_points?: number
          strategy_params?: Json
          take_profit_points?: number
          trailing_start_pts?: number
          trailing_step_pts?: number
          updated_at?: string
          user_id: string
          volume?: number
        }
        Update: {
          breakeven_trigger_pts?: number
          cooldown_s?: number
          cooldown_until?: string | null
          created_at?: string
          daily_gain_limit_brl?: number
          daily_loss_limit_brl?: number
          enabled?: boolean
          exit_mode?: string
          id?: string
          initial_balance_brl?: number
          max_consec_losses?: number
          max_drawdown_brl?: number
          max_duration_s?: number
          max_spread_ticks?: number
          max_trades_day?: number
          min_score?: number
          mode?: string
          profile?: string
          signal_ttl_s?: number
          stop_loss_points?: number
          strategy_params?: Json
          take_profit_points?: number
          trailing_start_pts?: number
          trailing_step_pts?: number
          updated_at?: string
          user_id?: string
          volume?: number
        }
        Relationships: []
      }
      b3_mt5sim_runs: {
        Row: {
          created_at: string
          id: string
          last_tick_at: string | null
          last_tick_price: number | null
          note: string | null
          started_at: string
          status: string
          stopped_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_tick_at?: string | null
          last_tick_price?: number | null
          note?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_tick_at?: string | null
          last_tick_price?: number | null
          note?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      b3_mt5sim_settings: {
        Row: {
          account_masked: string | null
          allow_long: boolean
          allow_reverse: boolean
          allow_short: boolean
          created_at: string
          default_volume: number
          engine: string
          fee_per_contract_brl: number
          id: string
          kill_switch_real: boolean
          market: string
          max_drawdown_brl: number
          max_price_divergence_pts: number
          max_tick_age_seconds: number
          max_tick_jump_pts: number
          min_days: number
          min_hit_rate: number
          min_net_pnl_brl: number
          min_risk_reward: number
          min_trades_per_robot: number
          mt5_symbol: string
          point_value_brl: number
          poll_interval_ms: number
          price_source: string
          quote_ttl_seconds: number
          server: string
          session_end: string
          session_start: string
          slippage_ticks: number
          slippage_ticks_entry: number
          slippage_ticks_exit: number
          tick_size: number
          tick_value_brl: number
          updated_at: string
          use_spread: boolean
          user_id: string
        }
        Insert: {
          account_masked?: string | null
          allow_long?: boolean
          allow_reverse?: boolean
          allow_short?: boolean
          created_at?: string
          default_volume?: number
          engine?: string
          fee_per_contract_brl?: number
          id?: string
          kill_switch_real?: boolean
          market?: string
          max_drawdown_brl?: number
          max_price_divergence_pts?: number
          max_tick_age_seconds?: number
          max_tick_jump_pts?: number
          min_days?: number
          min_hit_rate?: number
          min_net_pnl_brl?: number
          min_risk_reward?: number
          min_trades_per_robot?: number
          mt5_symbol?: string
          point_value_brl?: number
          poll_interval_ms?: number
          price_source?: string
          quote_ttl_seconds?: number
          server?: string
          session_end?: string
          session_start?: string
          slippage_ticks?: number
          slippage_ticks_entry?: number
          slippage_ticks_exit?: number
          tick_size?: number
          tick_value_brl?: number
          updated_at?: string
          use_spread?: boolean
          user_id: string
        }
        Update: {
          account_masked?: string | null
          allow_long?: boolean
          allow_reverse?: boolean
          allow_short?: boolean
          created_at?: string
          default_volume?: number
          engine?: string
          fee_per_contract_brl?: number
          id?: string
          kill_switch_real?: boolean
          market?: string
          max_drawdown_brl?: number
          max_price_divergence_pts?: number
          max_tick_age_seconds?: number
          max_tick_jump_pts?: number
          min_days?: number
          min_hit_rate?: number
          min_net_pnl_brl?: number
          min_risk_reward?: number
          min_trades_per_robot?: number
          mt5_symbol?: string
          point_value_brl?: number
          poll_interval_ms?: number
          price_source?: string
          quote_ttl_seconds?: number
          server?: string
          session_end?: string
          session_start?: string
          slippage_ticks?: number
          slippage_ticks_entry?: number
          slippage_ticks_exit?: number
          tick_size?: number
          tick_value_brl?: number
          updated_at?: string
          use_spread?: boolean
          user_id?: string
        }
        Relationships: []
      }
      b3_mt5sim_signals: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          price_signal: number
          reason: string | null
          robot_id: string
          score: number
          side: string
          signal_hash: string | null
          status: string
          ts: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          price_signal: number
          reason?: string | null
          robot_id: string
          score?: number
          side: string
          signal_hash?: string | null
          status?: string
          ts?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          price_signal?: number
          reason?: string | null
          robot_id?: string
          score?: number
          side?: string
          signal_hash?: string | null
          status?: string
          ts?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_mt5sim_signals_robot_id_fkey"
            columns: ["robot_id"]
            isOneToOne: false
            referencedRelation: "b3_mt5sim_robots"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_mt5sim_trades: {
        Row: {
          best_price: number | null
          breakeven_active: boolean
          created_at: string
          duration_s: number | null
          entry_reason: string | null
          exit_reason: string | null
          exit_reason_detail: string | null
          fee_brl: number
          gross_brl: number | null
          id: string
          initial_risk_brl: number | null
          initial_target_brl: number | null
          locks_triggered: Json
          logical_symbol: string
          mae_brl: number | null
          mae_pts: number | null
          market: string
          max_open_profit_brl: number | null
          mfe_brl: number | null
          mfe_pts: number | null
          mt5_symbol: string
          net_brl: number | null
          observations: string | null
          points_result: number | null
          price_entry_sim: number
          price_exit_sim: number | null
          price_signal: number | null
          risk_reward_ratio: number | null
          robot_id: string
          session_date: string
          side: string
          signal_id: string | null
          slippage_ticks: number | null
          spread: number | null
          spread_entry_ticks: number | null
          spread_exit_ticks: number | null
          status: string
          stop_price: number | null
          target_price: number | null
          tick_age_entry_s: number | null
          tick_age_exit_s: number | null
          trailing_stop_price: number | null
          ts_entry: string
          ts_exit: string | null
          ts_signal: string | null
          updated_at: string
          user_id: string
          volume: number
          worst_price: number | null
        }
        Insert: {
          best_price?: number | null
          breakeven_active?: boolean
          created_at?: string
          duration_s?: number | null
          entry_reason?: string | null
          exit_reason?: string | null
          exit_reason_detail?: string | null
          fee_brl?: number
          gross_brl?: number | null
          id?: string
          initial_risk_brl?: number | null
          initial_target_brl?: number | null
          locks_triggered?: Json
          logical_symbol?: string
          mae_brl?: number | null
          mae_pts?: number | null
          market?: string
          max_open_profit_brl?: number | null
          mfe_brl?: number | null
          mfe_pts?: number | null
          mt5_symbol: string
          net_brl?: number | null
          observations?: string | null
          points_result?: number | null
          price_entry_sim: number
          price_exit_sim?: number | null
          price_signal?: number | null
          risk_reward_ratio?: number | null
          robot_id: string
          session_date?: string
          side: string
          signal_id?: string | null
          slippage_ticks?: number | null
          spread?: number | null
          spread_entry_ticks?: number | null
          spread_exit_ticks?: number | null
          status?: string
          stop_price?: number | null
          target_price?: number | null
          tick_age_entry_s?: number | null
          tick_age_exit_s?: number | null
          trailing_stop_price?: number | null
          ts_entry?: string
          ts_exit?: string | null
          ts_signal?: string | null
          updated_at?: string
          user_id: string
          volume?: number
          worst_price?: number | null
        }
        Update: {
          best_price?: number | null
          breakeven_active?: boolean
          created_at?: string
          duration_s?: number | null
          entry_reason?: string | null
          exit_reason?: string | null
          exit_reason_detail?: string | null
          fee_brl?: number
          gross_brl?: number | null
          id?: string
          initial_risk_brl?: number | null
          initial_target_brl?: number | null
          locks_triggered?: Json
          logical_symbol?: string
          mae_brl?: number | null
          mae_pts?: number | null
          market?: string
          max_open_profit_brl?: number | null
          mfe_brl?: number | null
          mfe_pts?: number | null
          mt5_symbol?: string
          net_brl?: number | null
          observations?: string | null
          points_result?: number | null
          price_entry_sim?: number
          price_exit_sim?: number | null
          price_signal?: number | null
          risk_reward_ratio?: number | null
          robot_id?: string
          session_date?: string
          side?: string
          signal_id?: string | null
          slippage_ticks?: number | null
          spread?: number | null
          spread_entry_ticks?: number | null
          spread_exit_ticks?: number | null
          status?: string
          stop_price?: number | null
          target_price?: number | null
          tick_age_entry_s?: number | null
          tick_age_exit_s?: number | null
          trailing_stop_price?: number | null
          ts_entry?: string
          ts_exit?: string | null
          ts_signal?: string | null
          updated_at?: string
          user_id?: string
          volume?: number
          worst_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "b3_mt5sim_trades_robot_id_fkey"
            columns: ["robot_id"]
            isOneToOne: false
            referencedRelation: "b3_mt5sim_robots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_mt5sim_trades_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "b3_mt5sim_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_mt5sim_wallet_daily: {
        Row: {
          best_trade_brl: number
          blocks_count: number
          consec_losses: number
          created_at: string
          current_balance_brl: number
          drawdown_brl: number
          fees_brl: number
          hit_rate: number
          id: string
          last_block_reason: string | null
          last_signal_at: string | null
          losses: number
          peak_balance_brl: number
          pnl_gross_brl: number
          pnl_net_brl: number
          points_net: number
          position_avg_price: number | null
          position_qty: number | null
          position_side: string | null
          robot_id: string
          session_date: string
          starting_balance_brl: number
          status: string
          trades_count: number
          updated_at: string
          user_id: string
          wins: number
          worst_trade_brl: number
        }
        Insert: {
          best_trade_brl?: number
          blocks_count?: number
          consec_losses?: number
          created_at?: string
          current_balance_brl?: number
          drawdown_brl?: number
          fees_brl?: number
          hit_rate?: number
          id?: string
          last_block_reason?: string | null
          last_signal_at?: string | null
          losses?: number
          peak_balance_brl?: number
          pnl_gross_brl?: number
          pnl_net_brl?: number
          points_net?: number
          position_avg_price?: number | null
          position_qty?: number | null
          position_side?: string | null
          robot_id: string
          session_date: string
          starting_balance_brl?: number
          status?: string
          trades_count?: number
          updated_at?: string
          user_id: string
          wins?: number
          worst_trade_brl?: number
        }
        Update: {
          best_trade_brl?: number
          blocks_count?: number
          consec_losses?: number
          created_at?: string
          current_balance_brl?: number
          drawdown_brl?: number
          fees_brl?: number
          hit_rate?: number
          id?: string
          last_block_reason?: string | null
          last_signal_at?: string | null
          losses?: number
          peak_balance_brl?: number
          pnl_gross_brl?: number
          pnl_net_brl?: number
          points_net?: number
          position_avg_price?: number | null
          position_qty?: number | null
          position_side?: string | null
          robot_id?: string
          session_date?: string
          starting_balance_brl?: number
          status?: string
          trades_count?: number
          updated_at?: string
          user_id?: string
          wins?: number
          worst_trade_brl?: number
        }
        Relationships: [
          {
            foreignKeyName: "b3_mt5sim_wallet_daily_robot_id_fkey"
            columns: ["robot_id"]
            isOneToOne: false
            referencedRelation: "b3_mt5sim_robots"
            referencedColumns: ["id"]
          },
        ]
      }
      b3_orders: {
        Row: {
          close_reason: string | null
          contract_code: string
          created_at: string
          entry_price: number
          entry_time: string
          environment: string
          execution_price: number | null
          execution_price_origin: string | null
          exit_price: number | null
          exit_time: string | null
          fees: number
          gross_result_brl: number | null
          gross_result_points: number | null
          id: string
          legacy_price_detected: boolean
          net_result_brl: number | null
          provider_name: string
          quantity: number
          quote_ask: number | null
          quote_bid: number | null
          quote_last: number | null
          quote_server: string | null
          quote_source: string
          quote_symbol: string | null
          quote_tick_ts: string | null
          side: string
          status: string
          symbol: string
          updated_at: string
          user_id: string
        }
        Insert: {
          close_reason?: string | null
          contract_code: string
          created_at?: string
          entry_price: number
          entry_time?: string
          environment?: string
          execution_price?: number | null
          execution_price_origin?: string | null
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          gross_result_brl?: number | null
          gross_result_points?: number | null
          id?: string
          legacy_price_detected?: boolean
          net_result_brl?: number | null
          provider_name?: string
          quantity?: number
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_server?: string | null
          quote_source?: string
          quote_symbol?: string | null
          quote_tick_ts?: string | null
          side: string
          status?: string
          symbol?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          close_reason?: string | null
          contract_code?: string
          created_at?: string
          entry_price?: number
          entry_time?: string
          environment?: string
          execution_price?: number | null
          execution_price_origin?: string | null
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          gross_result_brl?: number | null
          gross_result_points?: number | null
          id?: string
          legacy_price_detected?: boolean
          net_result_brl?: number | null
          provider_name?: string
          quantity?: number
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_server?: string | null
          quote_source?: string
          quote_symbol?: string | null
          quote_tick_ts?: string | null
          side?: string
          status?: string
          symbol?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_paridade_modalidades: {
        Row: {
          amostra_confiavel: boolean | null
          calculado_em: string
          correlacao: number | null
          desvio_a: number | null
          desvio_b: number | null
          desvio_juntas: number | null
          desvio_se_independentes: number | null
          dias_em_comum: number
          dias_mesmo_sinal: number
          janela_desde: string
          media_a: number | null
          media_b: number | null
          pct_mesmo_sinal: number | null
          reducao_pct: number | null
          symbol: string
          variant_a: string
          variant_b: string
        }
        Insert: {
          amostra_confiavel?: boolean | null
          calculado_em?: string
          correlacao?: number | null
          desvio_a?: number | null
          desvio_b?: number | null
          desvio_juntas?: number | null
          desvio_se_independentes?: number | null
          dias_em_comum: number
          dias_mesmo_sinal: number
          janela_desde: string
          media_a?: number | null
          media_b?: number | null
          pct_mesmo_sinal?: number | null
          reducao_pct?: number | null
          symbol: string
          variant_a: string
          variant_b: string
        }
        Update: {
          amostra_confiavel?: boolean | null
          calculado_em?: string
          correlacao?: number | null
          desvio_a?: number | null
          desvio_b?: number | null
          desvio_juntas?: number | null
          desvio_se_independentes?: number | null
          dias_em_comum?: number
          dias_mesmo_sinal?: number
          janela_desde?: string
          media_a?: number | null
          media_b?: number | null
          pct_mesmo_sinal?: number | null
          reducao_pct?: number | null
          symbol?: string
          variant_a?: string
          variant_b?: string
        }
        Relationships: []
      }
      b3_prd_authorization_log: {
        Row: {
          de_enabled: boolean | null
          de_max_daily_loss_brl: number | null
          de_max_qty: number | null
          id: string
          mode: string
          motivo: string | null
          origem: string | null
          para_enabled: boolean | null
          para_max_daily_loss_brl: number | null
          para_max_qty: number | null
          sessao_id: string | null
          symbol: string
          ts: string
          user_id: string
          variant: string
        }
        Insert: {
          de_enabled?: boolean | null
          de_max_daily_loss_brl?: number | null
          de_max_qty?: number | null
          id?: string
          mode: string
          motivo?: string | null
          origem?: string | null
          para_enabled?: boolean | null
          para_max_daily_loss_brl?: number | null
          para_max_qty?: number | null
          sessao_id?: string | null
          symbol: string
          ts?: string
          user_id: string
          variant?: string
        }
        Update: {
          de_enabled?: boolean | null
          de_max_daily_loss_brl?: number | null
          de_max_qty?: number | null
          id?: string
          mode?: string
          motivo?: string | null
          origem?: string | null
          para_enabled?: boolean | null
          para_max_daily_loss_brl?: number | null
          para_max_qty?: number | null
          sessao_id?: string | null
          symbol?: string
          ts?: string
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_prd_authorizations: {
        Row: {
          authorized_at: string | null
          authorized_by: string | null
          created_at: string
          enabled: boolean
          id: string
          magic_number: number | null
          max_daily_loss_brl: number
          max_daily_loss_mult: number | null
          max_qty: number
          mode: string
          notes: string | null
          revoked_at: string | null
          symbol: string
          updated_at: string
          user_id: string
          variant: string
        }
        Insert: {
          authorized_at?: string | null
          authorized_by?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          magic_number?: number | null
          max_daily_loss_brl?: number
          max_daily_loss_mult?: number | null
          max_qty?: number
          mode: string
          notes?: string | null
          revoked_at?: string | null
          symbol: string
          updated_at?: string
          user_id: string
          variant?: string
        }
        Update: {
          authorized_at?: string | null
          authorized_by?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          magic_number?: number | null
          max_daily_loss_brl?: number
          max_daily_loss_mult?: number | null
          max_qty?: number
          mode?: string
          notes?: string | null
          revoked_at?: string | null
          symbol?: string
          updated_at?: string
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_pregao_saude: {
        Row: {
          avaliado_em: string
          cobertura_pct: number | null
          cotacao_parada: number
          fechamentos_manuais: number
          guard_preco: number
          limpo: boolean
          maior_buraco_min: number
          minutos_com_candle: number
          minutos_esperados: number
          motivo_sujo: string | null
          ordens_fantasma: number
          primeiro_tick: string | null
          stops_pendentes: number
          trade_date: string
          ultimo_tick: string | null
          user_id: string
        }
        Insert: {
          avaliado_em?: string
          cobertura_pct?: number | null
          cotacao_parada?: number
          fechamentos_manuais?: number
          guard_preco?: number
          limpo?: boolean
          maior_buraco_min?: number
          minutos_com_candle?: number
          minutos_esperados?: number
          motivo_sujo?: string | null
          ordens_fantasma?: number
          primeiro_tick?: string | null
          stops_pendentes?: number
          trade_date: string
          ultimo_tick?: string | null
          user_id: string
        }
        Update: {
          avaliado_em?: string
          cobertura_pct?: number | null
          cotacao_parada?: number
          fechamentos_manuais?: number
          guard_preco?: number
          limpo?: boolean
          maior_buraco_min?: number
          minutos_com_candle?: number
          minutos_esperados?: number
          motivo_sujo?: string | null
          ordens_fantasma?: number
          primeiro_tick?: string | null
          stops_pendentes?: number
          trade_date?: string
          ultimo_tick?: string | null
          user_id?: string
        }
        Relationships: []
      }
      b3_pregoes_qualidade: {
        Row: {
          atualizado_em: string
          classificacao: string
          confirmado_por: string | null
          evidencia: Json | null
          motivo: string
          pregao: string
        }
        Insert: {
          atualizado_em?: string
          classificacao: string
          confirmado_por?: string | null
          evidencia?: Json | null
          motivo: string
          pregao: string
        }
        Update: {
          atualizado_em?: string
          classificacao?: string
          confirmado_por?: string | null
          evidencia?: Json | null
          motivo?: string
          pregao?: string
        }
        Relationships: []
      }
      b3_real_account_peak: {
        Row: {
          armed: boolean
          armed_at: string | null
          armed_giveback_brl: number | null
          armed_giveback_pct: number | null
          armed_peak_brl: number | null
          armed_result_brl: number | null
          circuit_armed: boolean
          circuit_armed_at: string | null
          circuit_base_brl: number | null
          circuit_gain_latched: boolean
          circuit_gain_latched_at: string | null
          circuit_gain_latched_open: number | null
          circuit_gain_latched_result_brl: number | null
          circuit_kind: string | null
          circuit_result_brl: number | null
          circuit_robots: number | null
          created_at: string
          id: string
          last_result_brl: number
          peak_at: string | null
          peak_brl: number
          session_date: string
          updated_at: string
          user_id: string
        }
        Insert: {
          armed?: boolean
          armed_at?: string | null
          armed_giveback_brl?: number | null
          armed_giveback_pct?: number | null
          armed_peak_brl?: number | null
          armed_result_brl?: number | null
          circuit_armed?: boolean
          circuit_armed_at?: string | null
          circuit_base_brl?: number | null
          circuit_gain_latched?: boolean
          circuit_gain_latched_at?: string | null
          circuit_gain_latched_open?: number | null
          circuit_gain_latched_result_brl?: number | null
          circuit_kind?: string | null
          circuit_result_brl?: number | null
          circuit_robots?: number | null
          created_at?: string
          id?: string
          last_result_brl?: number
          peak_at?: string | null
          peak_brl?: number
          session_date: string
          updated_at?: string
          user_id: string
        }
        Update: {
          armed?: boolean
          armed_at?: string | null
          armed_giveback_brl?: number | null
          armed_giveback_pct?: number | null
          armed_peak_brl?: number | null
          armed_result_brl?: number | null
          circuit_armed?: boolean
          circuit_armed_at?: string | null
          circuit_base_brl?: number | null
          circuit_gain_latched?: boolean
          circuit_gain_latched_at?: string | null
          circuit_gain_latched_open?: number | null
          circuit_gain_latched_result_brl?: number | null
          circuit_kind?: string | null
          circuit_result_brl?: number | null
          circuit_robots?: number | null
          created_at?: string
          id?: string
          last_result_brl?: number
          peak_at?: string | null
          peak_brl?: number
          session_date?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_real_carteira: {
        Row: {
          criado_em: string
          data: string
          id: string
          observacao: string | null
          tipo: string
          user_id: string
          valor_brl: number
        }
        Insert: {
          criado_em?: string
          data?: string
          id?: string
          observacao?: string | null
          tipo: string
          user_id: string
          valor_brl: number
        }
        Update: {
          criado_em?: string
          data?: string
          id?: string
          observacao?: string | null
          tipo?: string
          user_id?: string
          valor_brl?: number
        }
        Relationships: []
      }
      b3_real_execution_state: {
        Row: {
          daily_circuit_enabled: boolean
          daily_gain_target_pct: number
          daily_loss_cap_pct: number
          peak_giveback_pct: number
          peak_min_brl: number
          peak_min_pct_of_global: number
          real_enabled: boolean
          resumed_at: string | null
          stopped_at: string | null
          stopped_by: string | null
          stopped_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          daily_circuit_enabled?: boolean
          daily_gain_target_pct?: number
          daily_loss_cap_pct?: number
          peak_giveback_pct?: number
          peak_min_brl?: number
          peak_min_pct_of_global?: number
          real_enabled?: boolean
          resumed_at?: string | null
          stopped_at?: string | null
          stopped_by?: string | null
          stopped_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          daily_circuit_enabled?: boolean
          daily_gain_target_pct?: number
          daily_loss_cap_pct?: number
          peak_giveback_pct?: number
          peak_min_brl?: number
          peak_min_pct_of_global?: number
          real_enabled?: boolean
          resumed_at?: string | null
          stopped_at?: string | null
          stopped_by?: string | null
          stopped_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_regime_dia: {
        Row: {
          amplitude: number
          amplitude_sobre_ruido: number
          calculado_em: string
          deslocamento: number
          eficiencia: number
          minutos: number
          p90_minuto: number
          symbol: string
          trade_date: string
        }
        Insert: {
          amplitude: number
          amplitude_sobre_ruido: number
          calculado_em?: string
          deslocamento: number
          eficiencia: number
          minutos: number
          p90_minuto: number
          symbol: string
          trade_date: string
        }
        Update: {
          amplitude?: number
          amplitude_sobre_ruido?: number
          calculado_em?: string
          deslocamento?: number
          eficiencia?: number
          minutos?: number
          p90_minuto?: number
          symbol?: string
          trade_date?: string
        }
        Relationships: []
      }
      b3_robot_curation: {
        Row: {
          best_streak: number
          caiu_de_verde_em: string | null
          last_evaluated_date: string | null
          medal: boolean
          medal_at: string | null
          medal_revoked_at: string | null
          mode: string
          neg_streak: number
          streak_days: number
          symbol: string
          updated_at: string
          user_id: string
          variant: string
        }
        Insert: {
          best_streak?: number
          caiu_de_verde_em?: string | null
          last_evaluated_date?: string | null
          medal?: boolean
          medal_at?: string | null
          medal_revoked_at?: string | null
          mode: string
          neg_streak?: number
          streak_days?: number
          symbol: string
          updated_at?: string
          user_id: string
          variant?: string
        }
        Update: {
          best_streak?: number
          caiu_de_verde_em?: string | null
          last_evaluated_date?: string | null
          medal?: boolean
          medal_at?: string | null
          medal_revoked_at?: string | null
          mode?: string
          neg_streak?: number
          streak_days?: number
          symbol?: string
          updated_at?: string
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_robot_curation_log: {
        Row: {
          evento: string
          id: string
          mode: string
          motivo: string | null
          score: number | null
          streak_days: number | null
          symbol: string
          trade_date: string
          ts: string
          user_id: string
          variant: string
        }
        Insert: {
          evento: string
          id?: string
          mode: string
          motivo?: string | null
          score?: number | null
          streak_days?: number | null
          symbol: string
          trade_date: string
          ts?: string
          user_id: string
          variant: string
        }
        Update: {
          evento?: string
          id?: string
          mode?: string
          motivo?: string | null
          score?: number | null
          streak_days?: number | null
          symbol?: string
          trade_date?: string
          ts?: string
          user_id?: string
          variant?: string
        }
        Relationships: []
      }
      b3_robot_daily_score: {
        Row: {
          created_at: string
          dia_com_intervencao: boolean
          max_dd_brl: number
          mode: string
          motivo_intervencao: string | null
          net_brl: number
          net_brl_com_violacao: number | null
          net_brl_livre: number | null
          pico_contratos: number | null
          pico_hora: string | null
          pico_margem_brl: number | null
          qualified: boolean
          r_unit_brl: number
          rank_day: number | null
          s_dd: number
          s_net: number
          s_wr: number
          score: number
          symbol: string
          trade_date: string
          trades: number
          trades_bloqueado_sombra: number
          trades_stop_violado: number
          user_id: string
          variant: string
          win_rate: number
          wins: number
        }
        Insert: {
          created_at?: string
          dia_com_intervencao?: boolean
          max_dd_brl?: number
          mode: string
          motivo_intervencao?: string | null
          net_brl?: number
          net_brl_com_violacao?: number | null
          net_brl_livre?: number | null
          pico_contratos?: number | null
          pico_hora?: string | null
          pico_margem_brl?: number | null
          qualified?: boolean
          r_unit_brl?: number
          rank_day?: number | null
          s_dd?: number
          s_net?: number
          s_wr?: number
          score?: number
          symbol: string
          trade_date: string
          trades?: number
          trades_bloqueado_sombra?: number
          trades_stop_violado?: number
          user_id: string
          variant?: string
          win_rate?: number
          wins?: number
        }
        Update: {
          created_at?: string
          dia_com_intervencao?: boolean
          max_dd_brl?: number
          mode?: string
          motivo_intervencao?: string | null
          net_brl?: number
          net_brl_com_violacao?: number | null
          net_brl_livre?: number | null
          pico_contratos?: number | null
          pico_hora?: string | null
          pico_margem_brl?: number | null
          qualified?: boolean
          r_unit_brl?: number
          rank_day?: number | null
          s_dd?: number
          s_net?: number
          s_wr?: number
          score?: number
          symbol?: string
          trade_date?: string
          trades?: number
          trades_bloqueado_sombra?: number
          trades_stop_violado?: number
          user_id?: string
          variant?: string
          win_rate?: number
          wins?: number
        }
        Relationships: []
      }
      b3_runs_experimentais: {
        Row: {
          criado_em: string
          motivo: string
          run_id: string
        }
        Insert: {
          criado_em?: string
          motivo: string
          run_id: string
        }
        Update: {
          criado_em?: string
          motivo?: string
          run_id?: string
        }
        Relationships: []
      }
      b3_simulation_agent_votes: {
        Row: {
          agent_name: string
          confidence: number
          created_at: string
          decision: string | null
          has_veto: boolean | null
          id: string
          market_data_snapshot: Json
          mode: string
          order_id: string | null
          reason: string | null
          score: number | null
          side: string | null
          simulation_mode_id: string
          simulation_run_id: string
          tick_snapshot_id: string | null
          user_id: string
          veto_reason: string | null
          vote: string
        }
        Insert: {
          agent_name: string
          confidence?: number
          created_at?: string
          decision?: string | null
          has_veto?: boolean | null
          id?: string
          market_data_snapshot?: Json
          mode: string
          order_id?: string | null
          reason?: string | null
          score?: number | null
          side?: string | null
          simulation_mode_id: string
          simulation_run_id: string
          tick_snapshot_id?: string | null
          user_id: string
          veto_reason?: string | null
          vote: string
        }
        Update: {
          agent_name?: string
          confidence?: number
          created_at?: string
          decision?: string | null
          has_veto?: boolean | null
          id?: string
          market_data_snapshot?: Json
          mode?: string
          order_id?: string | null
          reason?: string | null
          score?: number | null
          side?: string | null
          simulation_mode_id?: string
          simulation_run_id?: string
          tick_snapshot_id?: string | null
          user_id?: string
          veto_reason?: string | null
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_simulation_agent_votes_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_agent_votes_simulation_mode_id_fkey"
            columns: ["simulation_mode_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_agent_votes_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_agent_votes_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_simulation_block_events: {
        Row: {
          created_at: string
          diagnostic_payload: Json
          id: string
          limit_value: number | null
          message: string | null
          mode: string
          mt5_last: number | null
          new_status: string
          observed_value: number | null
          occurred_at: string
          pnl_at_moment: number | null
          prev_status: string | null
          price_source: string | null
          provider_name: string | null
          rejected_price: number | null
          related_order_id: string | null
          simulation_mode_id: string | null
          simulation_run_id: string
          trigger: string
          user_id: string
        }
        Insert: {
          created_at?: string
          diagnostic_payload?: Json
          id?: string
          limit_value?: number | null
          message?: string | null
          mode: string
          mt5_last?: number | null
          new_status: string
          observed_value?: number | null
          occurred_at?: string
          pnl_at_moment?: number | null
          prev_status?: string | null
          price_source?: string | null
          provider_name?: string | null
          rejected_price?: number | null
          related_order_id?: string | null
          simulation_mode_id?: string | null
          simulation_run_id: string
          trigger: string
          user_id: string
        }
        Update: {
          created_at?: string
          diagnostic_payload?: Json
          id?: string
          limit_value?: number | null
          message?: string | null
          mode?: string
          mt5_last?: number | null
          new_status?: string
          observed_value?: number | null
          occurred_at?: string
          pnl_at_moment?: number | null
          prev_status?: string | null
          price_source?: string | null
          provider_name?: string | null
          rejected_price?: number | null
          related_order_id?: string | null
          simulation_mode_id?: string | null
          simulation_run_id?: string
          trigger?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_simulation_block_events_simulation_mode_id_fkey"
            columns: ["simulation_mode_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_block_events_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_block_events_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_simulation_market_snapshots: {
        Row: {
          candle_close: number | null
          candle_high: number | null
          candle_low: number | null
          candle_open: number | null
          created_at: string
          extra: Json
          id: string
          market_time: string
          price: number
          provider_name: string
          quote_ask: number | null
          quote_bid: number | null
          quote_last: number | null
          quote_server: string | null
          quote_source: string
          quote_symbol: string | null
          quote_tick_ts: string | null
          simulation_run_id: string
          source: string
          symbol: string
          user_id: string
          volume: number | null
          vwap: number | null
        }
        Insert: {
          candle_close?: number | null
          candle_high?: number | null
          candle_low?: number | null
          candle_open?: number | null
          created_at?: string
          extra?: Json
          id?: string
          market_time?: string
          price: number
          provider_name?: string
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_server?: string | null
          quote_source?: string
          quote_symbol?: string | null
          quote_tick_ts?: string | null
          simulation_run_id: string
          source?: string
          symbol?: string
          user_id: string
          volume?: number | null
          vwap?: number | null
        }
        Update: {
          candle_close?: number | null
          candle_high?: number | null
          candle_low?: number | null
          candle_open?: number | null
          created_at?: string
          extra?: Json
          id?: string
          market_time?: string
          price?: number
          provider_name?: string
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_server?: string | null
          quote_source?: string
          quote_symbol?: string | null
          quote_tick_ts?: string | null
          simulation_run_id?: string
          source?: string
          symbol?: string
          user_id?: string
          volume?: number | null
          vwap?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "b3_simulation_market_snapshots_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_market_snapshots_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_simulation_mode_settings: {
        Row: {
          breakeven_ativa_pct_stop: number | null
          breakeven_ativa_pts: number | null
          breakeven_folga_pct_stop: number | null
          breakeven_folga_pts: number | null
          breakout_min_clearance_pts: number | null
          confirmacao_ativa_real: boolean
          confirmacao_ativa_simulado: boolean
          confirmacao_janela_s: number
          confirmacao_pct_stop: number
          consecutive_loss_after_target: number
          created_at: string
          daily_gain_target_brl: number
          daily_gain_target_pct: number | null
          daily_loss_limit_brl: number
          daily_loss_limit_pct: number | null
          daily_stop_mult: number
          enabled: boolean
          entry_cutoff_time: string
          entry_style: string
          force_close_time: string
          gain_pts: number
          id: string
          lateral_strength_min: number | null
          lateral_vol_min: number | null
          limites_proporcionais: boolean
          max_contracts: number
          max_volatility_pct: number
          min_approve_votes: number
          min_confidence: number
          min_score: number
          minimum_operating_minutes: number
          minimum_trades_before_profit_lock: number
          mode: string
          notes: string | null
          peak_giveback_pct: number
          peak_lock_min_profit_brl: number | null
          peak_lock_min_profit_pct: number | null
          post_target_allowed_retracement: number
          post_target_size_reduction: number
          profit_multiplier_before_lock: number
          proporcional_capital_ref_brl: number | null
          range_min_size_pts: number | null
          risco_contratos_pct: number | null
          simulation_run_id: string
          stop_pts: number
          trading_start_time: string
          trailing_activation_pct_stop: number | null
          trailing_activation_pts: number
          trailing_giveback_pct_stop: number | null
          trailing_giveback_pts: number
          trailing_mode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          breakeven_ativa_pct_stop?: number | null
          breakeven_ativa_pts?: number | null
          breakeven_folga_pct_stop?: number | null
          breakeven_folga_pts?: number | null
          breakout_min_clearance_pts?: number | null
          confirmacao_ativa_real?: boolean
          confirmacao_ativa_simulado?: boolean
          confirmacao_janela_s?: number
          confirmacao_pct_stop?: number
          consecutive_loss_after_target?: number
          created_at?: string
          daily_gain_target_brl?: number
          daily_gain_target_pct?: number | null
          daily_loss_limit_brl?: number
          daily_loss_limit_pct?: number | null
          daily_stop_mult?: number
          enabled?: boolean
          entry_cutoff_time?: string
          entry_style?: string
          force_close_time?: string
          gain_pts?: number
          id?: string
          lateral_strength_min?: number | null
          lateral_vol_min?: number | null
          limites_proporcionais?: boolean
          max_contracts?: number
          max_volatility_pct?: number
          min_approve_votes?: number
          min_confidence?: number
          min_score?: number
          minimum_operating_minutes?: number
          minimum_trades_before_profit_lock?: number
          mode: string
          notes?: string | null
          peak_giveback_pct?: number
          peak_lock_min_profit_brl?: number | null
          peak_lock_min_profit_pct?: number | null
          post_target_allowed_retracement?: number
          post_target_size_reduction?: number
          profit_multiplier_before_lock?: number
          proporcional_capital_ref_brl?: number | null
          range_min_size_pts?: number | null
          risco_contratos_pct?: number | null
          simulation_run_id: string
          stop_pts?: number
          trading_start_time?: string
          trailing_activation_pct_stop?: number | null
          trailing_activation_pts?: number
          trailing_giveback_pct_stop?: number | null
          trailing_giveback_pts?: number
          trailing_mode?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          breakeven_ativa_pct_stop?: number | null
          breakeven_ativa_pts?: number | null
          breakeven_folga_pct_stop?: number | null
          breakeven_folga_pts?: number | null
          breakout_min_clearance_pts?: number | null
          confirmacao_ativa_real?: boolean
          confirmacao_ativa_simulado?: boolean
          confirmacao_janela_s?: number
          confirmacao_pct_stop?: number
          consecutive_loss_after_target?: number
          created_at?: string
          daily_gain_target_brl?: number
          daily_gain_target_pct?: number | null
          daily_loss_limit_brl?: number
          daily_loss_limit_pct?: number | null
          daily_stop_mult?: number
          enabled?: boolean
          entry_cutoff_time?: string
          entry_style?: string
          force_close_time?: string
          gain_pts?: number
          id?: string
          lateral_strength_min?: number | null
          lateral_vol_min?: number | null
          limites_proporcionais?: boolean
          max_contracts?: number
          max_volatility_pct?: number
          min_approve_votes?: number
          min_confidence?: number
          min_score?: number
          minimum_operating_minutes?: number
          minimum_trades_before_profit_lock?: number
          mode?: string
          notes?: string | null
          peak_giveback_pct?: number
          peak_lock_min_profit_brl?: number | null
          peak_lock_min_profit_pct?: number | null
          post_target_allowed_retracement?: number
          post_target_size_reduction?: number
          profit_multiplier_before_lock?: number
          proporcional_capital_ref_brl?: number | null
          range_min_size_pts?: number | null
          risco_contratos_pct?: number | null
          simulation_run_id?: string
          stop_pts?: number
          trading_start_time?: string
          trailing_activation_pct_stop?: number | null
          trailing_activation_pts?: number
          trailing_giveback_pct_stop?: number | null
          trailing_giveback_pts?: number
          trailing_mode?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_simulation_mode_settings_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_mode_settings_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_simulation_modes: {
        Row: {
          committee_approvals: number
          committee_rejections: number
          confirmacao_pendente: Json | null
          consecutive_losses_after_target: number
          contracts_traded: number
          created_at: string
          current_balance: number
          current_status: string
          day_peak_profit_brl: number
          id: string
          initial_balance: number
          last_trigger: string | null
          losing_trades: number
          max_drawdown: number
          max_gain: number
          max_loss: number
          mode: string
          peak_profit_after_target_brl: number
          points_result: number
          profit_after_target_brl: number
          profit_at_target_brl: number | null
          protection_block_reason: string | null
          protection_day_key: string | null
          protection_state: string
          realized_pnl: number
          risk_blocks: number
          simulation_run_id: string
          status: string
          status_changed_at: string | null
          status_reason: string | null
          target_reached_at: string | null
          total_fees: number
          total_trades: number
          trades_after_target: number
          trades_at_target: number | null
          unrealized_pnl: number
          updated_at: string
          user_id: string
          winning_trades: number
        }
        Insert: {
          committee_approvals?: number
          committee_rejections?: number
          confirmacao_pendente?: Json | null
          consecutive_losses_after_target?: number
          contracts_traded?: number
          created_at?: string
          current_balance?: number
          current_status?: string
          day_peak_profit_brl?: number
          id?: string
          initial_balance?: number
          last_trigger?: string | null
          losing_trades?: number
          max_drawdown?: number
          max_gain?: number
          max_loss?: number
          mode: string
          peak_profit_after_target_brl?: number
          points_result?: number
          profit_after_target_brl?: number
          profit_at_target_brl?: number | null
          protection_block_reason?: string | null
          protection_day_key?: string | null
          protection_state?: string
          realized_pnl?: number
          risk_blocks?: number
          simulation_run_id: string
          status?: string
          status_changed_at?: string | null
          status_reason?: string | null
          target_reached_at?: string | null
          total_fees?: number
          total_trades?: number
          trades_after_target?: number
          trades_at_target?: number | null
          unrealized_pnl?: number
          updated_at?: string
          user_id: string
          winning_trades?: number
        }
        Update: {
          committee_approvals?: number
          committee_rejections?: number
          confirmacao_pendente?: Json | null
          consecutive_losses_after_target?: number
          contracts_traded?: number
          created_at?: string
          current_balance?: number
          current_status?: string
          day_peak_profit_brl?: number
          id?: string
          initial_balance?: number
          last_trigger?: string | null
          losing_trades?: number
          max_drawdown?: number
          max_gain?: number
          max_loss?: number
          mode?: string
          peak_profit_after_target_brl?: number
          points_result?: number
          profit_after_target_brl?: number
          profit_at_target_brl?: number | null
          protection_block_reason?: string | null
          protection_day_key?: string | null
          protection_state?: string
          realized_pnl?: number
          risk_blocks?: number
          simulation_run_id?: string
          status?: string
          status_changed_at?: string | null
          status_reason?: string | null
          target_reached_at?: string | null
          total_fees?: number
          total_trades?: number
          trades_after_target?: number
          trades_at_target?: number | null
          unrealized_pnl?: number
          updated_at?: string
          user_id?: string
          winning_trades?: number
        }
        Relationships: [
          {
            foreignKeyName: "b3_simulation_modes_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_modes_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_simulation_orders: {
        Row: {
          alvo_recalculado: number | null
          bloqueado_na_sombra: boolean
          close_reason: string | null
          confirmacao_exigida_pts: number | null
          confirmacao_janela_s: number | null
          confirmou: boolean | null
          confirmou_em: string | null
          contract_code: string
          created_at: string
          diagnostic_payload: Json
          entry_approve_votes: number | null
          entry_confidence: number | null
          entry_price: number
          entry_score: number | null
          entry_setup: string | null
          entry_time: string
          execution_price: number | null
          execution_price_origin: string | null
          exit_price: number | null
          exit_time: string | null
          fees: number
          freios_na_sombra: string[]
          gain_pts: number | null
          gross_result_brl: number
          gross_result_points: number
          id: string
          last_eval_minute_ts: string | null
          legacy_price_detected: boolean
          mae_pts: number | null
          mfe_pts: number | null
          mode: string
          net_result_brl: number
          nivel_freio_na_abertura: number | null
          preco_confirmacao: number | null
          provider_name: string
          quantity: number
          quote_ask: number | null
          quote_bid: number | null
          quote_last: number | null
          quote_server: string | null
          quote_source: string
          quote_symbol: string | null
          quote_tick_ts: string | null
          side: string
          simulation_mode_id: string
          simulation_run_id: string
          status: string
          stop_excedido_pts: number | null
          stop_price: number | null
          stop_pts: number | null
          stop_recalculado: number | null
          stop_violado: boolean
          symbol: string
          target_price: number | null
          unrealized_brl: number | null
          unrealized_points: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alvo_recalculado?: number | null
          bloqueado_na_sombra?: boolean
          close_reason?: string | null
          confirmacao_exigida_pts?: number | null
          confirmacao_janela_s?: number | null
          confirmou?: boolean | null
          confirmou_em?: string | null
          contract_code?: string
          created_at?: string
          diagnostic_payload?: Json
          entry_approve_votes?: number | null
          entry_confidence?: number | null
          entry_price: number
          entry_score?: number | null
          entry_setup?: string | null
          entry_time?: string
          execution_price?: number | null
          execution_price_origin?: string | null
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          freios_na_sombra?: string[]
          gain_pts?: number | null
          gross_result_brl?: number
          gross_result_points?: number
          id?: string
          last_eval_minute_ts?: string | null
          legacy_price_detected?: boolean
          mae_pts?: number | null
          mfe_pts?: number | null
          mode: string
          net_result_brl?: number
          nivel_freio_na_abertura?: number | null
          preco_confirmacao?: number | null
          provider_name?: string
          quantity?: number
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_server?: string | null
          quote_source?: string
          quote_symbol?: string | null
          quote_tick_ts?: string | null
          side: string
          simulation_mode_id: string
          simulation_run_id: string
          status?: string
          stop_excedido_pts?: number | null
          stop_price?: number | null
          stop_pts?: number | null
          stop_recalculado?: number | null
          stop_violado?: boolean
          symbol?: string
          target_price?: number | null
          unrealized_brl?: number | null
          unrealized_points?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alvo_recalculado?: number | null
          bloqueado_na_sombra?: boolean
          close_reason?: string | null
          confirmacao_exigida_pts?: number | null
          confirmacao_janela_s?: number | null
          confirmou?: boolean | null
          confirmou_em?: string | null
          contract_code?: string
          created_at?: string
          diagnostic_payload?: Json
          entry_approve_votes?: number | null
          entry_confidence?: number | null
          entry_price?: number
          entry_score?: number | null
          entry_setup?: string | null
          entry_time?: string
          execution_price?: number | null
          execution_price_origin?: string | null
          exit_price?: number | null
          exit_time?: string | null
          fees?: number
          freios_na_sombra?: string[]
          gain_pts?: number | null
          gross_result_brl?: number
          gross_result_points?: number
          id?: string
          last_eval_minute_ts?: string | null
          legacy_price_detected?: boolean
          mae_pts?: number | null
          mfe_pts?: number | null
          mode?: string
          net_result_brl?: number
          nivel_freio_na_abertura?: number | null
          preco_confirmacao?: number | null
          provider_name?: string
          quantity?: number
          quote_ask?: number | null
          quote_bid?: number | null
          quote_last?: number | null
          quote_server?: string | null
          quote_source?: string
          quote_symbol?: string | null
          quote_tick_ts?: string | null
          side?: string
          simulation_mode_id?: string
          simulation_run_id?: string
          status?: string
          stop_excedido_pts?: number | null
          stop_price?: number | null
          stop_pts?: number | null
          stop_recalculado?: number | null
          stop_violado?: boolean
          symbol?: string
          target_price?: number | null
          unrealized_brl?: number | null
          unrealized_points?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "b3_simulation_orders_simulation_mode_id_fkey"
            columns: ["simulation_mode_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_orders_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "b3_simulation_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "b3_simulation_orders_simulation_run_id_fkey"
            columns: ["simulation_run_id"]
            isOneToOne: false
            referencedRelation: "v_b3_cat_robos"
            referencedColumns: ["run_id"]
          },
        ]
      }
      b3_simulation_runs: {
        Row: {
          created_at: string
          end_date: string | null
          ended_at: string | null
          entry_cutoff_time: string
          force_close_time: string
          id: string
          initial_balance: number
          market_source: string
          max_contracts: number
          notes: string | null
          session_date: string | null
          session_day_id: string | null
          simulated_fee_brl: number
          simulated_slippage_pts: number
          start_date: string | null
          started_at: string
          status: string
          symbol: string
          trading_start_time: string
          updated_at: string
          user_id: string
          variant: string
          winner_mode: string | null
        }
        Insert: {
          created_at?: string
          end_date?: string | null
          ended_at?: string | null
          entry_cutoff_time?: string
          force_close_time?: string
          id?: string
          initial_balance?: number
          market_source?: string
          max_contracts?: number
          notes?: string | null
          session_date?: string | null
          session_day_id?: string | null
          simulated_fee_brl?: number
          simulated_slippage_pts?: number
          start_date?: string | null
          started_at?: string
          status?: string
          symbol?: string
          trading_start_time?: string
          updated_at?: string
          user_id: string
          variant?: string
          winner_mode?: string | null
        }
        Update: {
          created_at?: string
          end_date?: string | null
          ended_at?: string | null
          entry_cutoff_time?: string
          force_close_time?: string
          id?: string
          initial_balance?: number
          market_source?: string
          max_contracts?: number
          notes?: string | null
          session_date?: string | null
          session_day_id?: string | null
          simulated_fee_brl?: number
          simulated_slippage_pts?: number
          start_date?: string | null
          started_at?: string
          status?: string
          symbol?: string
          trading_start_time?: string
          updated_at?: string
          user_id?: string
          variant?: string
          winner_mode?: string | null
        }
        Relationships: []
      }
      b3_trading_settings: {
        Row: {
          alert_only_enabled: boolean
          api_status: string
          auto_trade_enabled: boolean
          broker_name: string
          capital_allocated: number
          capital_disponivel_brl: number
          created_at: string
          daily_gain_target: number
          daily_loss_limit: number
          data_inicio_analise: string | null
          dias_limpos_para_medalha: number
          end_time: string
          environment: string
          force_close_time: string
          gain_points: number
          global_daily_loss_limit_brl: number
          id: string
          max_contracts: number
          mt5_guard_mode: string
          mt5_price_deviation_limit: number
          mt5_require_nonzero_last: boolean
          mt5_require_nonzero_volume: boolean
          mt5_spread_max_points: number
          mt5_tick_ttl_seconds: number
          mt5_tick_ttl_tolerance_seconds: number
          price_source: string
          start_time: string
          stop_points: number
          strategy_mode: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_only_enabled?: boolean
          api_status?: string
          auto_trade_enabled?: boolean
          broker_name?: string
          capital_allocated?: number
          capital_disponivel_brl?: number
          created_at?: string
          daily_gain_target?: number
          daily_loss_limit?: number
          data_inicio_analise?: string | null
          dias_limpos_para_medalha?: number
          end_time?: string
          environment?: string
          force_close_time?: string
          gain_points?: number
          global_daily_loss_limit_brl?: number
          id?: string
          max_contracts?: number
          mt5_guard_mode?: string
          mt5_price_deviation_limit?: number
          mt5_require_nonzero_last?: boolean
          mt5_require_nonzero_volume?: boolean
          mt5_spread_max_points?: number
          mt5_tick_ttl_seconds?: number
          mt5_tick_ttl_tolerance_seconds?: number
          price_source?: string
          start_time?: string
          stop_points?: number
          strategy_mode?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_only_enabled?: boolean
          api_status?: string
          auto_trade_enabled?: boolean
          broker_name?: string
          capital_allocated?: number
          capital_disponivel_brl?: number
          created_at?: string
          daily_gain_target?: number
          daily_loss_limit?: number
          data_inicio_analise?: string | null
          dias_limpos_para_medalha?: number
          end_time?: string
          environment?: string
          force_close_time?: string
          gain_points?: number
          global_daily_loss_limit_brl?: number
          id?: string
          max_contracts?: number
          mt5_guard_mode?: string
          mt5_price_deviation_limit?: number
          mt5_require_nonzero_last?: boolean
          mt5_require_nonzero_volume?: boolean
          mt5_spread_max_points?: number
          mt5_tick_ttl_seconds?: number
          mt5_tick_ttl_tolerance_seconds?: number
          price_source?: string
          start_time?: string
          stop_points?: number
          strategy_mode?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      b3_variant_apelidos: {
        Row: {
          apelido_tela: string
          descricao: string | null
          ordem: number | null
          variant: string
        }
        Insert: {
          apelido_tela: string
          descricao?: string | null
          ordem?: number | null
          variant: string
        }
        Update: {
          apelido_tela?: string
          descricao?: string | null
          ordem?: number | null
          variant?: string
        }
        Relationships: []
      }
      b3_vigia_tique: {
        Row: {
          acao: string
          cotacao_ha_seg: number | null
          decisao_ha_seg: number | null
          detectado_em: string
          id: string
          observacao: string | null
          request_id: number | null
        }
        Insert: {
          acao: string
          cotacao_ha_seg?: number | null
          decisao_ha_seg?: number | null
          detectado_em?: string
          id?: string
          observacao?: string | null
          request_id?: number | null
        }
        Update: {
          acao?: string
          cotacao_ha_seg?: number | null
          decisao_ha_seg?: number | null
          detectado_em?: string
          id?: string
          observacao?: string | null
          request_id?: number | null
        }
        Relationships: []
      }
      backtest_agent_votes: {
        Row: {
          agent_id: string | null
          agent_name: string
          candle_time: string
          confidence: number
          created_at: string
          has_veto: boolean
          id: string
          outcome: string | null
          pair: string
          perceived_risk: number
          run_id: string
          timeframe: string
          vote: string
          weight_used: number
        }
        Insert: {
          agent_id?: string | null
          agent_name: string
          candle_time: string
          confidence?: number
          created_at?: string
          has_veto?: boolean
          id?: string
          outcome?: string | null
          pair: string
          perceived_risk?: number
          run_id: string
          timeframe: string
          vote: string
          weight_used?: number
        }
        Update: {
          agent_id?: string | null
          agent_name?: string
          candle_time?: string
          confidence?: number
          created_at?: string
          has_veto?: boolean
          id?: string
          outcome?: string | null
          pair?: string
          perceived_risk?: number
          run_id?: string
          timeframe?: string
          vote?: string
          weight_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "backtest_agent_votes_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backtest_agent_votes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_metrics: {
        Row: {
          avg_hold_minutes: number
          avg_rr: number
          biggest_loss: number
          biggest_win: number
          breakdown_by_agent: Json | null
          breakdown_by_asset: Json | null
          breakdown_by_decision: Json | null
          breakdown_by_timeframe: Json | null
          created_at: string
          drawdown_curve: Json | null
          equity_curve: Json | null
          final_balance: number
          initial_balance: number
          max_drawdown: number
          max_drawdown_pct: number
          max_loss_streak: number
          max_win_streak: number
          n_losses: number
          n_trades: number
          n_wins: number
          profit_factor: number
          return_pct: number
          run_id: string
          total_pnl: number
          win_rate: number
        }
        Insert: {
          avg_hold_minutes?: number
          avg_rr?: number
          biggest_loss?: number
          biggest_win?: number
          breakdown_by_agent?: Json | null
          breakdown_by_asset?: Json | null
          breakdown_by_decision?: Json | null
          breakdown_by_timeframe?: Json | null
          created_at?: string
          drawdown_curve?: Json | null
          equity_curve?: Json | null
          final_balance?: number
          initial_balance?: number
          max_drawdown?: number
          max_drawdown_pct?: number
          max_loss_streak?: number
          max_win_streak?: number
          n_losses?: number
          n_trades?: number
          n_wins?: number
          profit_factor?: number
          return_pct?: number
          run_id: string
          total_pnl?: number
          win_rate?: number
        }
        Update: {
          avg_hold_minutes?: number
          avg_rr?: number
          biggest_loss?: number
          biggest_win?: number
          breakdown_by_agent?: Json | null
          breakdown_by_asset?: Json | null
          breakdown_by_decision?: Json | null
          breakdown_by_timeframe?: Json | null
          created_at?: string
          drawdown_curve?: Json | null
          equity_curve?: Json | null
          final_balance?: number
          initial_balance?: number
          max_drawdown?: number
          max_drawdown_pct?: number
          max_loss_streak?: number
          max_win_streak?: number
          n_losses?: number
          n_trades?: number
          n_wins?: number
          profit_factor?: number
          return_pct?: number
          run_id?: string
          total_pnl?: number
          win_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "backtest_metrics_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_reports: {
        Row: {
          best_trades: Json | null
          created_at: string
          highlights: Json | null
          pdf_path: string | null
          recommendation: string | null
          run_id: string
          summary: string | null
          warnings: Json | null
          worst_trades: Json | null
        }
        Insert: {
          best_trades?: Json | null
          created_at?: string
          highlights?: Json | null
          pdf_path?: string | null
          recommendation?: string | null
          run_id: string
          summary?: string | null
          warnings?: Json | null
          worst_trades?: Json | null
        }
        Update: {
          best_trades?: Json | null
          created_at?: string
          highlights?: Json | null
          pdf_path?: string | null
          recommendation?: string | null
          run_id?: string
          summary?: string | null
          warnings?: Json | null
          worst_trades?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "backtest_reports_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_runs: {
        Row: {
          created_at: string
          error_msg: string | null
          finished_at: string | null
          id: string
          mode: string
          name: string
          processed_candles: number
          started_at: string | null
          status: string
          summary: Json | null
          total_candles: number
        }
        Insert: {
          created_at?: string
          error_msg?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          name: string
          processed_candles?: number
          started_at?: string | null
          status?: string
          summary?: Json | null
          total_candles?: number
        }
        Update: {
          created_at?: string
          error_msg?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          name?: string
          processed_candles?: number
          started_at?: string | null
          status?: string
          summary?: Json | null
          total_candles?: number
        }
        Relationships: []
      }
      backtest_settings: {
        Row: {
          agent_ids: Json | null
          assets: Json
          consensus_rule: Json
          created_at: string
          drawdown_limit_pct: number
          fee_pct: number
          initial_balance: number
          loss_streak_limit: number
          max_trade_value: number
          period_end: string
          period_start: string
          reinvest: boolean
          run_id: string
          slippage_pct: number
          stop_loss_pct: number
          take_profit_pct: number
          timeframes: Json
        }
        Insert: {
          agent_ids?: Json | null
          assets: Json
          consensus_rule?: Json
          created_at?: string
          drawdown_limit_pct?: number
          fee_pct?: number
          initial_balance?: number
          loss_streak_limit?: number
          max_trade_value?: number
          period_end: string
          period_start: string
          reinvest?: boolean
          run_id: string
          slippage_pct?: number
          stop_loss_pct?: number
          take_profit_pct?: number
          timeframes: Json
        }
        Update: {
          agent_ids?: Json | null
          assets?: Json
          consensus_rule?: Json
          created_at?: string
          drawdown_limit_pct?: number
          fee_pct?: number
          initial_balance?: number
          loss_streak_limit?: number
          max_trade_value?: number
          period_end?: string
          period_start?: string
          reinvest?: boolean
          run_id?: string
          slippage_pct?: number
          stop_loss_pct?: number
          take_profit_pct?: number
          timeframes?: Json
        }
        Relationships: [
          {
            foreignKeyName: "backtest_settings_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: true
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      backtest_trades: {
        Row: {
          asset_id: string | null
          created_at: string
          entry_price: number
          entry_time: string
          exit_price: number | null
          exit_reason: string | null
          exit_time: string | null
          fee_paid: number
          hold_minutes: number | null
          id: string
          pair: string
          pnl: number | null
          pnl_pct: number | null
          quantity: number
          run_id: string
          side: string
          slippage_applied: number
          timeframe: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          entry_price: number
          entry_time: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          fee_paid?: number
          hold_minutes?: number | null
          id?: string
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          quantity: number
          run_id: string
          side: string
          slippage_applied?: number
          timeframe: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          entry_price?: number
          entry_time?: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          fee_paid?: number
          hold_minutes?: number | null
          id?: string
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          quantity?: number
          run_id?: string
          side?: string
          slippage_applied?: number
          timeframe?: string
        }
        Relationships: [
          {
            foreignKeyName: "backtest_trades_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "backtest_trades_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      binance_audit_learning: {
        Row: {
          avoidable: boolean | null
          candles_available: boolean | null
          classification: string | null
          confidence: number | null
          created_at: string
          diagnosis: string | null
          drawdown_avoided: number | null
          duplicate_of: string | null
          entry_price: number
          exit_price: number
          exit_time: string
          high_12h: number | null
          high_1h: number | null
          high_24h: number | null
          high_4h: number | null
          id: string
          indicators: Json | null
          low_12h: number | null
          low_1h: number | null
          low_24h: number | null
          low_4h: number | null
          motivos: Json | null
          pattern_key: string | null
          pnl: number | null
          pnl_pct: number | null
          position_size: number | null
          premature: boolean | null
          recommendation: string | null
          recovery_12h: number | null
          recovery_1h: number | null
          recovery_24h: number | null
          recovery_4h: number | null
          recovery_lost_pct: number | null
          recovery_lost_usdt: number | null
          recovery_max: number | null
          score: number | null
          side: string
          source: string
          symbol: string
          trade_id: string
          updated_at: string
        }
        Insert: {
          avoidable?: boolean | null
          candles_available?: boolean | null
          classification?: string | null
          confidence?: number | null
          created_at?: string
          diagnosis?: string | null
          drawdown_avoided?: number | null
          duplicate_of?: string | null
          entry_price: number
          exit_price: number
          exit_time: string
          high_12h?: number | null
          high_1h?: number | null
          high_24h?: number | null
          high_4h?: number | null
          id?: string
          indicators?: Json | null
          low_12h?: number | null
          low_1h?: number | null
          low_24h?: number | null
          low_4h?: number | null
          motivos?: Json | null
          pattern_key?: string | null
          pnl?: number | null
          pnl_pct?: number | null
          position_size?: number | null
          premature?: boolean | null
          recommendation?: string | null
          recovery_12h?: number | null
          recovery_1h?: number | null
          recovery_24h?: number | null
          recovery_4h?: number | null
          recovery_lost_pct?: number | null
          recovery_lost_usdt?: number | null
          recovery_max?: number | null
          score?: number | null
          side: string
          source: string
          symbol: string
          trade_id: string
          updated_at?: string
        }
        Update: {
          avoidable?: boolean | null
          candles_available?: boolean | null
          classification?: string | null
          confidence?: number | null
          created_at?: string
          diagnosis?: string | null
          drawdown_avoided?: number | null
          duplicate_of?: string | null
          entry_price?: number
          exit_price?: number
          exit_time?: string
          high_12h?: number | null
          high_1h?: number | null
          high_24h?: number | null
          high_4h?: number | null
          id?: string
          indicators?: Json | null
          low_12h?: number | null
          low_1h?: number | null
          low_24h?: number | null
          low_4h?: number | null
          motivos?: Json | null
          pattern_key?: string | null
          pnl?: number | null
          pnl_pct?: number | null
          position_size?: number | null
          premature?: boolean | null
          recommendation?: string | null
          recovery_12h?: number | null
          recovery_1h?: number | null
          recovery_24h?: number | null
          recovery_4h?: number | null
          recovery_lost_pct?: number | null
          recovery_lost_usdt?: number | null
          recovery_max?: number | null
          score?: number | null
          side?: string
          source?: string
          symbol?: string
          trade_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      binance_brain_audit: {
        Row: {
          approve_count: number | null
          brain_recommendation: string
          classification: string | null
          created_at: string
          dominant_trend: string | null
          expected_gross: number | null
          expected_net: number | null
          fee_buy: number | null
          fee_gate_passed: boolean | null
          fee_sell: number | null
          fib_levels: Json | null
          flex_mode: boolean | null
          id: string
          indicator_votes: Json
          neutral_count: number | null
          notional: number | null
          price: number
          qty: number | null
          rationale: string | null
          reject_count: number | null
          related_decision_id: string | null
          related_order_id: string | null
          sample_size: number | null
          score: number
          side: string
          slippage_pct: number | null
          spread_pct: number | null
          symbol: string
          timeframe_conflict: boolean | null
          trend_15d: string | null
          trend_15m: string | null
          trend_1d: string | null
          trend_1h: string | null
          trend_1m: string | null
          trend_30d: string | null
          trend_4h: string | null
          trend_5m: string | null
          trend_7d: string | null
          volatility_class: string | null
          volume_signal: string | null
        }
        Insert: {
          approve_count?: number | null
          brain_recommendation: string
          classification?: string | null
          created_at?: string
          dominant_trend?: string | null
          expected_gross?: number | null
          expected_net?: number | null
          fee_buy?: number | null
          fee_gate_passed?: boolean | null
          fee_sell?: number | null
          fib_levels?: Json | null
          flex_mode?: boolean | null
          id?: string
          indicator_votes?: Json
          neutral_count?: number | null
          notional?: number | null
          price: number
          qty?: number | null
          rationale?: string | null
          reject_count?: number | null
          related_decision_id?: string | null
          related_order_id?: string | null
          sample_size?: number | null
          score?: number
          side: string
          slippage_pct?: number | null
          spread_pct?: number | null
          symbol: string
          timeframe_conflict?: boolean | null
          trend_15d?: string | null
          trend_15m?: string | null
          trend_1d?: string | null
          trend_1h?: string | null
          trend_1m?: string | null
          trend_30d?: string | null
          trend_4h?: string | null
          trend_5m?: string | null
          trend_7d?: string | null
          volatility_class?: string | null
          volume_signal?: string | null
        }
        Update: {
          approve_count?: number | null
          brain_recommendation?: string
          classification?: string | null
          created_at?: string
          dominant_trend?: string | null
          expected_gross?: number | null
          expected_net?: number | null
          fee_buy?: number | null
          fee_gate_passed?: boolean | null
          fee_sell?: number | null
          fib_levels?: Json | null
          flex_mode?: boolean | null
          id?: string
          indicator_votes?: Json
          neutral_count?: number | null
          notional?: number | null
          price?: number
          qty?: number | null
          rationale?: string | null
          reject_count?: number | null
          related_decision_id?: string | null
          related_order_id?: string | null
          sample_size?: number | null
          score?: number
          side?: string
          slippage_pct?: number | null
          spread_pct?: number | null
          symbol?: string
          timeframe_conflict?: boolean | null
          trend_15d?: string | null
          trend_15m?: string | null
          trend_1d?: string | null
          trend_1h?: string | null
          trend_1m?: string | null
          trend_30d?: string | null
          trend_4h?: string | null
          trend_5m?: string | null
          trend_7d?: string | null
          volatility_class?: string | null
          volume_signal?: string | null
        }
        Relationships: []
      }
      binance_connection_status: {
        Row: {
          account_type: string | null
          connected: boolean
          id: number
          last_check: string | null
          last_error: string | null
          permissions: string[] | null
        }
        Insert: {
          account_type?: string | null
          connected?: boolean
          id?: number
          last_check?: string | null
          last_error?: string | null
          permissions?: string[] | null
        }
        Update: {
          account_type?: string | null
          connected?: boolean
          id?: number
          last_check?: string | null
          last_error?: string | null
          permissions?: string[] | null
        }
        Relationships: []
      }
      binance_indicator_performance: {
        Row: {
          hit_rate: number | null
          hits: number | null
          id: string
          indicator: string
          last_updated: string
          misses: number | null
          votes_approve: number | null
          votes_reject: number | null
          votes_total: number | null
          weight: number | null
        }
        Insert: {
          hit_rate?: number | null
          hits?: number | null
          id?: string
          indicator: string
          last_updated?: string
          misses?: number | null
          votes_approve?: number | null
          votes_reject?: number | null
          votes_total?: number | null
          weight?: number | null
        }
        Update: {
          hit_rate?: number | null
          hits?: number | null
          id?: string
          indicator?: string
          last_updated?: string
          misses?: number | null
          votes_approve?: number | null
          votes_reject?: number | null
          votes_total?: number | null
          weight?: number | null
        }
        Relationships: []
      }
      binance_position_decision_audit: {
        Row: {
          approved_capital: number | null
          committee_score: number | null
          council_score: number | null
          created_at: string
          decision_type: string
          id: string
          metadata: Json | null
          reason: string | null
          requested_capital: number | null
          risk_score: number | null
          symbol: string
        }
        Insert: {
          approved_capital?: number | null
          committee_score?: number | null
          council_score?: number | null
          created_at?: string
          decision_type: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          requested_capital?: number | null
          risk_score?: number | null
          symbol: string
        }
        Update: {
          approved_capital?: number | null
          committee_score?: number | null
          council_score?: number | null
          created_at?: string
          decision_type?: string
          id?: string
          metadata?: Json | null
          reason?: string | null
          requested_capital?: number | null
          risk_score?: number | null
          symbol?: string
        }
        Relationships: []
      }
      binance_trade_block_log: {
        Row: {
          created_at: string
          decision_id: string | null
          details: Json | null
          expected_net_profit: number | null
          expected_roi_pct: number | null
          id: string
          pair: string
          position_value: number | null
          reason: string
          total_fees_estimated: number | null
        }
        Insert: {
          created_at?: string
          decision_id?: string | null
          details?: Json | null
          expected_net_profit?: number | null
          expected_roi_pct?: number | null
          id?: string
          pair: string
          position_value?: number | null
          reason: string
          total_fees_estimated?: number | null
        }
        Update: {
          created_at?: string
          decision_id?: string | null
          details?: Json | null
          expected_net_profit?: number | null
          expected_roi_pct?: number | null
          id?: string
          pair?: string
          position_value?: number | null
          reason?: string
          total_fees_estimated?: number | null
        }
        Relationships: []
      }
      binance_wallet_reconciliation_audit: {
        Row: {
          affected_symbol: string | null
          amount: number | null
          details: Json | null
          detected_at: string
          divergence_type: string
          id: string
          root_cause: string | null
        }
        Insert: {
          affected_symbol?: string | null
          amount?: number | null
          details?: Json | null
          detected_at?: string
          divergence_type: string
          id?: string
          root_cause?: string | null
        }
        Update: {
          affected_symbol?: string | null
          amount?: number | null
          details?: Json | null
          detected_at?: string
          divergence_type?: string
          id?: string
          root_cause?: string | null
        }
        Relationships: []
      }
      candles: {
        Row: {
          close: number
          close_time: string
          created_at: string
          high: number
          id: string
          low: number
          open: number
          open_time: string
          pair: string
          timeframe: string
          volume: number
        }
        Insert: {
          close: number
          close_time: string
          created_at?: string
          high: number
          id?: string
          low: number
          open: number
          open_time: string
          pair: string
          timeframe: string
          volume: number
        }
        Update: {
          close?: number
          close_time?: string
          created_at?: string
          high?: number
          id?: string
          low?: number
          open?: number
          open_time?: string
          pair?: string
          timeframe?: string
          volume?: number
        }
        Relationships: []
      }
      capital_management_history: {
        Row: {
          balance: number | null
          confidence: number | null
          created_at: string
          current_drawdown: number | null
          final_size: number | null
          id: string
          reason: string | null
          recent_performance: number | null
          suggested_size: number | null
          volatility: number | null
        }
        Insert: {
          balance?: number | null
          confidence?: number | null
          created_at?: string
          current_drawdown?: number | null
          final_size?: number | null
          id?: string
          reason?: string | null
          recent_performance?: number | null
          suggested_size?: number | null
          volatility?: number | null
        }
        Update: {
          balance?: number | null
          confidence?: number | null
          created_at?: string
          current_drawdown?: number | null
          final_size?: number | null
          id?: string
          reason?: string | null
          recent_performance?: number | null
          suggested_size?: number | null
          volatility?: number | null
        }
        Relationships: []
      }
      circuit_breaker_events: {
        Row: {
          closed_at: string | null
          id: string
          message: string | null
          opened_at: string
          session_id: string | null
          trigger: string
        }
        Insert: {
          closed_at?: string | null
          id?: string
          message?: string | null
          opened_at?: string
          session_id?: string | null
          trigger: string
        }
        Update: {
          closed_at?: string | null
          id?: string
          message?: string | null
          opened_at?: string
          session_id?: string | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "circuit_breaker_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      committee_debates: {
        Row: {
          created_at: string
          decision_id: string
          id: string
          summary: string | null
          transcript: Json | null
        }
        Insert: {
          created_at?: string
          decision_id: string
          id?: string
          summary?: string | null
          transcript?: Json | null
        }
        Update: {
          created_at?: string
          decision_id?: string
          id?: string
          summary?: string | null
          transcript?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "committee_debates_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: true
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      committee_decisions: {
        Row: {
          asset_id: string | null
          avg_confidence: number
          classification: string
          consolidated_justification: string | null
          context: Json | null
          created_at: string
          data_quality: number
          euphoria_vetoed: boolean
          final_decision: string
          id: string
          pair: string
          risk_approved: boolean
          score: number
          session_id: string | null
          timeframe: string
          votes_buy: number
          votes_hold: number
          votes_sell: number
          votes_wait: number
        }
        Insert: {
          asset_id?: string | null
          avg_confidence?: number
          classification: string
          consolidated_justification?: string | null
          context?: Json | null
          created_at?: string
          data_quality?: number
          euphoria_vetoed?: boolean
          final_decision: string
          id?: string
          pair: string
          risk_approved?: boolean
          score?: number
          session_id?: string | null
          timeframe: string
          votes_buy?: number
          votes_hold?: number
          votes_sell?: number
          votes_wait?: number
        }
        Update: {
          asset_id?: string | null
          avg_confidence?: number
          classification?: string
          consolidated_justification?: string | null
          context?: Json | null
          created_at?: string
          data_quality?: number
          euphoria_vetoed?: boolean
          final_decision?: string
          id?: string
          pair?: string
          risk_approved?: boolean
          score?: number
          session_id?: string | null
          timeframe?: string
          votes_buy?: number
          votes_hold?: number
          votes_sell?: number
          votes_wait?: number
        }
        Relationships: [
          {
            foreignKeyName: "committee_decisions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "committee_decisions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      committee_settings: {
        Row: {
          default_stop_pct: number
          default_target_pct: number
          fee_coverage_multiplier: number
          id: number
          max_position_value: number
          min_confidence: number
          min_expected_roi_pct: number
          min_favor_votes: number
          min_net_profit_usd: number
          min_score: number
          per_trade_capital_pct: number
          taker_fee_pct: number
          timeframes: string[]
          updated_at: string
        }
        Insert: {
          default_stop_pct?: number
          default_target_pct?: number
          fee_coverage_multiplier?: number
          id?: number
          max_position_value?: number
          min_confidence?: number
          min_expected_roi_pct?: number
          min_favor_votes?: number
          min_net_profit_usd?: number
          min_score?: number
          per_trade_capital_pct?: number
          taker_fee_pct?: number
          timeframes?: string[]
          updated_at?: string
        }
        Update: {
          default_stop_pct?: number
          default_target_pct?: number
          fee_coverage_multiplier?: number
          id?: number
          max_position_value?: number
          min_confidence?: number
          min_expected_roi_pct?: number
          min_favor_votes?: number
          min_net_profit_usd?: number
          min_score?: number
          per_trade_capital_pct?: number
          taker_fee_pct?: number
          timeframes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      daily_reports: {
        Row: {
          alerts: Json
          content: string | null
          created_at: string
          drawdown: number | null
          id: string
          losses: number
          net_pnl: number | null
          recommendations: string | null
          report_date: string
          total_trades: number
          wins: number
        }
        Insert: {
          alerts?: Json
          content?: string | null
          created_at?: string
          drawdown?: number | null
          id?: string
          losses?: number
          net_pnl?: number | null
          recommendations?: string | null
          report_date: string
          total_trades?: number
          wins?: number
        }
        Update: {
          alerts?: Json
          content?: string | null
          created_at?: string
          drawdown?: number | null
          id?: string
          losses?: number
          net_pnl?: number | null
          recommendations?: string | null
          report_date?: string
          total_trades?: number
          wins?: number
        }
        Relationships: []
      }
      dynamic_agent_weights: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          new_weight: number | null
          performance_window: number | null
          previous_weight: number | null
          reason: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          new_weight?: number | null
          performance_window?: number | null
          previous_weight?: number | null
          reason?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          new_weight?: number | null
          performance_window?: number | null
          previous_weight?: number | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dynamic_agent_weights_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_categories: {
        Row: {
          description: string | null
          id: string
          label: string
          slug: string
        }
        Insert: {
          description?: string | null
          id?: string
          label: string
          slug: string
        }
        Update: {
          description?: string | null
          id?: string
          label?: string
          slug?: string
        }
        Relationships: []
      }
      expert_chunks: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          expert_id: string
          id: string
          metadata: Json | null
          source_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          expert_id: string
          id?: string
          metadata?: Json | null
          source_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          expert_id?: string
          id?: string
          metadata?: Json | null
          source_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_chunks_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expert_chunks_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "expert_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_sources: {
        Row: {
          chunk_count: number | null
          created_at: string
          error_msg: string | null
          expert_id: string
          id: string
          kind: string
          raw_text: string | null
          status: string
          storage_path: string | null
          title: string | null
          tokens: number | null
          updated_at: string
          url: string | null
        }
        Insert: {
          chunk_count?: number | null
          created_at?: string
          error_msg?: string | null
          expert_id: string
          id?: string
          kind: string
          raw_text?: string | null
          status?: string
          storage_path?: string | null
          title?: string | null
          tokens?: number | null
          updated_at?: string
          url?: string | null
        }
        Update: {
          chunk_count?: number | null
          created_at?: string
          error_msg?: string | null
          expert_id?: string
          id?: string
          kind?: string
          raw_text?: string | null
          status?: string
          storage_path?: string | null
          title?: string | null
          tokens?: number | null
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expert_sources_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: false
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      expert_strategy: {
        Row: {
          buy_criteria: string | null
          catchphrases: Json | null
          confirmation_criteria: string | null
          exclusion_criteria: string | null
          expert_id: string
          generated_at: string
          id: string
          philosophy: string | null
          risk_criteria: string | null
          sell_criteria: string | null
          updated_at: string
        }
        Insert: {
          buy_criteria?: string | null
          catchphrases?: Json | null
          confirmation_criteria?: string | null
          exclusion_criteria?: string | null
          expert_id: string
          generated_at?: string
          id?: string
          philosophy?: string | null
          risk_criteria?: string | null
          sell_criteria?: string | null
          updated_at?: string
        }
        Update: {
          buy_criteria?: string | null
          catchphrases?: Json | null
          confirmation_criteria?: string | null
          exclusion_criteria?: string | null
          expert_id?: string
          generated_at?: string
          id?: string
          philosophy?: string | null
          risk_criteria?: string | null
          sell_criteria?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "expert_strategy_expert_id_fkey"
            columns: ["expert_id"]
            isOneToOne: true
            referencedRelation: "experts"
            referencedColumns: ["id"]
          },
        ]
      }
      experts: {
        Row: {
          active: boolean
          agent_id: string | null
          bio: string | null
          category_id: string | null
          created_at: string
          id: string
          main_strategy: string | null
          name: string
          photo_url: string | null
          risk_profile: string
          sources_summary: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          agent_id?: string | null
          bio?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          main_strategy?: string | null
          name: string
          photo_url?: string | null
          risk_profile?: string
          sources_summary?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          agent_id?: string | null
          bio?: string | null
          category_id?: string | null
          created_at?: string
          id?: string
          main_strategy?: string | null
          name?: string
          photo_url?: string | null
          risk_profile?: string
          sources_summary?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "experts_agent_fk"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "experts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "expert_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      governance_settings: {
        Row: {
          automation_enabled: boolean
          automation_level: number
          created_at: string
          eligibility_min_days: number
          eligibility_min_profit_factor: number
          eligibility_min_trades: number
          id: string
          kill_switch_activated_at: string | null
          kill_switch_active: boolean
          kill_switch_reason: string | null
          max_consecutive_losses: number
          max_daily_losses: number
          max_drawdown_pct: number
          max_weekly_losses: number
          min_confidence_score: number
          min_consensus_for_auto: number
          min_risk_reward: number
          min_score_for_auto: number
          supervisor_enabled: boolean
          updated_at: string
        }
        Insert: {
          automation_enabled?: boolean
          automation_level?: number
          created_at?: string
          eligibility_min_days?: number
          eligibility_min_profit_factor?: number
          eligibility_min_trades?: number
          id?: string
          kill_switch_activated_at?: string | null
          kill_switch_active?: boolean
          kill_switch_reason?: string | null
          max_consecutive_losses?: number
          max_daily_losses?: number
          max_drawdown_pct?: number
          max_weekly_losses?: number
          min_confidence_score?: number
          min_consensus_for_auto?: number
          min_risk_reward?: number
          min_score_for_auto?: number
          supervisor_enabled?: boolean
          updated_at?: string
        }
        Update: {
          automation_enabled?: boolean
          automation_level?: number
          created_at?: string
          eligibility_min_days?: number
          eligibility_min_profit_factor?: number
          eligibility_min_trades?: number
          id?: string
          kill_switch_activated_at?: string | null
          kill_switch_active?: boolean
          kill_switch_reason?: string | null
          max_consecutive_losses?: number
          max_daily_losses?: number
          max_drawdown_pct?: number
          max_weekly_losses?: number
          min_confidence_score?: number
          min_consensus_for_auto?: number
          min_risk_reward?: number
          min_score_for_auto?: number
          supervisor_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      historical_candles: {
        Row: {
          asset_id: string
          close: number
          created_at: string
          high: number
          low: number
          open: number
          open_time: string
          source: string
          timeframe: string
          volume: number
        }
        Insert: {
          asset_id: string
          close: number
          created_at?: string
          high: number
          low: number
          open: number
          open_time: string
          source?: string
          timeframe: string
          volume?: number
        }
        Update: {
          asset_id?: string
          close?: number
          created_at?: string
          high?: number
          low?: number
          open?: number
          open_time?: string
          source?: string
          timeframe?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "historical_candles_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
        ]
      }
      indicators: {
        Row: {
          change_24h: number | null
          computed_at: string
          id: string
          ma_long: number | null
          ma_short: number | null
          macd: number | null
          macd_signal: number | null
          pair: string
          rsi: number | null
          timeframe: string
          volume_avg: number | null
        }
        Insert: {
          change_24h?: number | null
          computed_at?: string
          id?: string
          ma_long?: number | null
          ma_short?: number | null
          macd?: number | null
          macd_signal?: number | null
          pair: string
          rsi?: number | null
          timeframe: string
          volume_avg?: number | null
        }
        Update: {
          change_24h?: number | null
          computed_at?: string
          id?: string
          ma_long?: number | null
          ma_short?: number | null
          macd?: number | null
          macd_signal?: number | null
          pair?: string
          rsi?: number | null
          timeframe?: string
          volume_avg?: number | null
        }
        Relationships: []
      }
      intelligence_reports: {
        Row: {
          agent_evaluation: Json
          content: string
          created_at: string
          id: string
          kind: string
          metadata: Json
          recommendations: string | null
          risk_analysis: string | null
          summary: string | null
          technical_analysis: string | null
          title: string
          trade_ref: string | null
        }
        Insert: {
          agent_evaluation?: Json
          content: string
          created_at?: string
          id?: string
          kind: string
          metadata?: Json
          recommendations?: string | null
          risk_analysis?: string | null
          summary?: string | null
          technical_analysis?: string | null
          title: string
          trade_ref?: string | null
        }
        Update: {
          agent_evaluation?: Json
          content?: string
          created_at?: string
          id?: string
          kind?: string
          metadata?: Json
          recommendations?: string | null
          risk_analysis?: string | null
          summary?: string | null
          technical_analysis?: string | null
          title?: string
          trade_ref?: string | null
        }
        Relationships: []
      }
      knowledge_library: {
        Row: {
          author: string | null
          classification: Json
          content: string | null
          created_at: string
          embedding: string | null
          id: string
          metadata: Json
          source_type: string
          storage_path: string | null
          title: string
          url: string | null
        }
        Insert: {
          author?: string | null
          classification?: Json
          content?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          source_type: string
          storage_path?: string | null
          title: string
          url?: string | null
        }
        Update: {
          author?: string | null
          classification?: Json
          content?: string | null
          created_at?: string
          embedding?: string | null
          id?: string
          metadata?: Json
          source_type?: string
          storage_path?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      learning_recommendations: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          description: string
          evidence: Json
          expected_impact: Json
          id: string
          kind: string
          rationale: string | null
          status: string
          suggested_changes: Json
          title: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description: string
          evidence?: Json
          expected_impact?: Json
          id?: string
          kind: string
          rationale?: string | null
          status?: string
          suggested_changes?: Json
          title: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description?: string
          evidence?: Json
          expected_impact?: Json
          id?: string
          kind?: string
          rationale?: string | null
          status?: string
          suggested_changes?: Json
          title?: string
        }
        Relationships: []
      }
      live_simulated_positions: {
        Row: {
          asset_id: string | null
          created_at: string
          decision_id: string | null
          entry_price: number
          entry_time: string
          exit_price: number | null
          exit_reason: string | null
          exit_time: string | null
          id: string
          last_price: number | null
          pair: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          session_id: string | null
          side: string
          status: string
          stop_loss: number
          take_profit: number
          updated_at: string
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          decision_id?: string | null
          entry_price: number
          entry_time?: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          id?: string
          last_price?: number | null
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          session_id?: string | null
          side: string
          status?: string
          stop_loss: number
          take_profit: number
          updated_at?: string
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          decision_id?: string | null
          entry_price?: number
          entry_time?: string
          exit_price?: number | null
          exit_reason?: string | null
          exit_time?: string | null
          id?: string
          last_price?: number | null
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          session_id?: string | null
          side?: string
          status?: string
          stop_loss?: number
          take_profit?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_simulated_positions_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_simulated_positions_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_simulated_positions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      live_trade_metrics: {
        Row: {
          day: string
          drawdown: number | null
          id: string
          n_trades: number | null
          n_wins: number | null
          pnl: number | null
          profit_factor: number | null
          return_pct: number | null
          session_id: string | null
          sharpe: number | null
          win_rate: number | null
        }
        Insert: {
          day: string
          drawdown?: number | null
          id?: string
          n_trades?: number | null
          n_wins?: number | null
          pnl?: number | null
          profit_factor?: number | null
          return_pct?: number | null
          session_id?: string | null
          sharpe?: number | null
          win_rate?: number | null
        }
        Update: {
          day?: string
          drawdown?: number | null
          id?: string
          n_trades?: number | null
          n_wins?: number | null
          pnl?: number | null
          profit_factor?: number | null
          return_pct?: number | null
          session_id?: string | null
          sharpe?: number | null
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "live_trade_metrics_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      market_regimes: {
        Row: {
          asset_id: string | null
          confidence: number
          detected_at: string
          id: string
          metadata: Json
          regime: string
          trend_strength: number | null
          volatility: number | null
        }
        Insert: {
          asset_id?: string | null
          confidence?: number
          detected_at?: string
          id?: string
          metadata?: Json
          regime: string
          trend_strength?: number | null
          volatility?: number | null
        }
        Update: {
          asset_id?: string | null
          confidence?: number
          detected_at?: string
          id?: string
          metadata?: Json
          regime?: string
          trend_strength?: number | null
          volatility?: number | null
        }
        Relationships: []
      }
      monitored_assets: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          notes: string | null
          pair: string
          timeframes: string[]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          pair: string
          timeframes?: string[]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          pair?: string
          timeframes?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      opportunity_radar: {
        Row: {
          asset_id: string | null
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          metadata: Json
          reason: string
          score: number
          symbol: string | null
        }
        Insert: {
          asset_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          metadata?: Json
          reason: string
          score?: number
          symbol?: string | null
        }
        Update: {
          asset_id?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          metadata?: Json
          reason?: string
          score?: number
          symbol?: string | null
        }
        Relationships: []
      }
      real_circuit_breaker_events: {
        Row: {
          closed_at: string | null
          closed_by: string | null
          id: string
          message: string
          opened_at: string
          severity: string
          trigger: string
        }
        Insert: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          message: string
          opened_at?: string
          severity?: string
          trigger: string
        }
        Update: {
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          message?: string
          opened_at?: string
          severity?: string
          trigger?: string
        }
        Relationships: []
      }
      real_orders: {
        Row: {
          asset_id: string | null
          binance_order_id: string | null
          binance_status: string | null
          filled_at: string | null
          id: string
          pair: string
          pnl: number | null
          pnl_pct: number | null
          price: number | null
          qty: number
          raw_response: Json | null
          request_id: string | null
          session_id: string | null
          side: string
          stop_loss: number | null
          submitted_at: string
          take_profit: number | null
          type: string
        }
        Insert: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          filled_at?: string | null
          id?: string
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          price?: number | null
          qty: number
          raw_response?: Json | null
          request_id?: string | null
          session_id?: string | null
          side: string
          stop_loss?: number | null
          submitted_at?: string
          take_profit?: number | null
          type?: string
        }
        Update: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          filled_at?: string | null
          id?: string
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          price?: number | null
          qty?: number
          raw_response?: Json | null
          request_id?: string | null
          session_id?: string | null
          side?: string
          stop_loss?: number | null
          submitted_at?: string
          take_profit?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "real_orders_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      real_positions: {
        Row: {
          asset_id: string | null
          closed_at: string | null
          entry_price: number
          exit_price: number | null
          exit_reason: string | null
          id: string
          last_price: number | null
          opened_at: string
          order_id: string | null
          pair: string
          pnl: number | null
          pnl_pct: number | null
          qty: number
          request_id: string | null
          side: string
          status: string
          stop_loss: number
          take_profit: number
        }
        Insert: {
          asset_id?: string | null
          closed_at?: string | null
          entry_price: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          last_price?: number | null
          opened_at?: string
          order_id?: string | null
          pair: string
          pnl?: number | null
          pnl_pct?: number | null
          qty: number
          request_id?: string | null
          side: string
          status?: string
          stop_loss: number
          take_profit: number
        }
        Update: {
          asset_id?: string | null
          closed_at?: string | null
          entry_price?: number
          exit_price?: number | null
          exit_reason?: string | null
          id?: string
          last_price?: number | null
          opened_at?: string
          order_id?: string | null
          pair?: string
          pnl?: number | null
          pnl_pct?: number | null
          qty?: number
          request_id?: string | null
          side?: string
          status?: string
          stop_loss?: number
          take_profit?: number
        }
        Relationships: [
          {
            foreignKeyName: "real_positions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "real_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "real_positions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      real_risk_limits: {
        Row: {
          daily_loss_limit: number
          id: number
          loss_streak_limit: number
          max_open_positions: number
          max_pct_portfolio: number
          max_per_trade: number
          max_trades_per_day: number
          monthly_loss_limit: number
          updated_at: string
          weekly_loss_limit: number
        }
        Insert: {
          daily_loss_limit?: number
          id?: number
          loss_streak_limit?: number
          max_open_positions?: number
          max_pct_portfolio?: number
          max_per_trade?: number
          max_trades_per_day?: number
          monthly_loss_limit?: number
          updated_at?: string
          weekly_loss_limit?: number
        }
        Update: {
          daily_loss_limit?: number
          id?: number
          loss_streak_limit?: number
          max_open_positions?: number
          max_pct_portfolio?: number
          max_per_trade?: number
          max_trades_per_day?: number
          monthly_loss_limit?: number
          updated_at?: string
          weekly_loss_limit?: number
        }
        Relationships: []
      }
      real_trade_approvals: {
        Row: {
          action: string
          approver_user_id: string
          created_at: string
          id: string
          ip: string | null
          note: string | null
          request_id: string
          user_agent: string | null
        }
        Insert: {
          action: string
          approver_user_id: string
          created_at?: string
          id?: string
          ip?: string | null
          note?: string | null
          request_id: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          approver_user_id?: string
          created_at?: string
          id?: string
          ip?: string | null
          note?: string | null
          request_id?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "real_trade_approvals_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      real_trade_requests: {
        Row: {
          asset_id: string | null
          checklist: Json
          created_at: string
          decision_id: string | null
          expected_result: number | null
          expires_at: string | null
          id: string
          justification: string | null
          pair: string
          risk_amount: number
          score: number
          session_id: string | null
          side: string
          status: string
          stop_loss: number
          suggested_price: number
          suggested_qty: number
          take_profit: number
          updated_at: string
          vetoes: Json
          votes_against: number
          votes_for: number
          worst_case: number | null
        }
        Insert: {
          asset_id?: string | null
          checklist?: Json
          created_at?: string
          decision_id?: string | null
          expected_result?: number | null
          expires_at?: string | null
          id?: string
          justification?: string | null
          pair: string
          risk_amount: number
          score: number
          session_id?: string | null
          side: string
          status?: string
          stop_loss: number
          suggested_price: number
          suggested_qty: number
          take_profit: number
          updated_at?: string
          vetoes?: Json
          votes_against?: number
          votes_for?: number
          worst_case?: number | null
        }
        Update: {
          asset_id?: string | null
          checklist?: Json
          created_at?: string
          decision_id?: string | null
          expected_result?: number | null
          expires_at?: string | null
          id?: string
          justification?: string | null
          pair?: string
          risk_amount?: number
          score?: number
          session_id?: string | null
          side?: string
          status?: string
          stop_loss?: number
          suggested_price?: number
          suggested_qty?: number
          take_profit?: number
          updated_at?: string
          vetoes?: Json
          votes_against?: number
          votes_for?: number
          worst_case?: number | null
        }
        Relationships: []
      }
      reputation_history: {
        Row: {
          agent_id: string | null
          drawdown: number | null
          hit_rate: number | null
          id: string
          n_votes: number | null
          pnl_total: number | null
          snapshot_at: string
          weight: number | null
        }
        Insert: {
          agent_id?: string | null
          drawdown?: number | null
          hit_rate?: number | null
          id?: string
          n_votes?: number | null
          pnl_total?: number | null
          snapshot_at?: string
          weight?: number | null
        }
        Update: {
          agent_id?: string | null
          drawdown?: number | null
          hit_rate?: number | null
          id?: string
          n_votes?: number | null
          pnl_total?: number | null
          snapshot_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reputation_history_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_events: {
        Row: {
          created_at: string
          id: string
          kind: string
          message: string
          meta: Json | null
          session_id: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          message: string
          meta?: Json | null
          session_id?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          message?: string
          meta?: Json | null
          session_id?: string | null
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_incidents: {
        Row: {
          created_at: string
          data: Json
          id: string
          kind: string
          message: string | null
          resolved_at: string | null
          severity: string
        }
        Insert: {
          created_at?: string
          data?: Json
          id?: string
          kind: string
          message?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Update: {
          created_at?: string
          data?: Json
          id?: string
          kind?: string
          message?: string | null
          resolved_at?: string | null
          severity?: string
        }
        Relationships: []
      }
      robot_confidence: {
        Row: {
          accuracy_component: number | null
          agents_precision_component: number | null
          computed_at: string
          data_quality_component: number | null
          drawdown_component: number | null
          id: string
          performance_component: number | null
          score: number
        }
        Insert: {
          accuracy_component?: number | null
          agents_precision_component?: number | null
          computed_at?: string
          data_quality_component?: number | null
          drawdown_component?: number | null
          id?: string
          performance_component?: number | null
          score: number
        }
        Update: {
          accuracy_component?: number | null
          agents_precision_component?: number | null
          computed_at?: string
          data_quality_component?: number | null
          drawdown_component?: number | null
          id?: string
          performance_component?: number | null
          score?: number
        }
        Relationships: []
      }
      robot_settings: {
        Row: {
          active_timeframes: string[]
          alerts_telegram_enabled: boolean | null
          alerts_whatsapp_enabled: boolean | null
          binance_mock_mode: boolean
          collect_frequency_seconds: number
          daily_loss_limit: number | null
          default_stop_pct: number | null
          default_take_pct: number | null
          id: number
          max_loss_streak: number | null
          max_per_asset: number | null
          max_per_trade: number | null
          max_portfolio_exposure: number | null
          min_score_for_real: number
          mode: string
          monthly_loss_limit: number | null
          phase_ready: boolean | null
          production_assisted_enabled: boolean
          production_auto_enabled: boolean
          rate_limit_per_minute: number
          real_robot_paused: boolean
          require_manual_approval: boolean
          status: string
          updated_at: string
          weekly_loss_limit: number | null
        }
        Insert: {
          active_timeframes?: string[]
          alerts_telegram_enabled?: boolean | null
          alerts_whatsapp_enabled?: boolean | null
          binance_mock_mode?: boolean
          collect_frequency_seconds?: number
          daily_loss_limit?: number | null
          default_stop_pct?: number | null
          default_take_pct?: number | null
          id?: number
          max_loss_streak?: number | null
          max_per_asset?: number | null
          max_per_trade?: number | null
          max_portfolio_exposure?: number | null
          min_score_for_real?: number
          mode?: string
          monthly_loss_limit?: number | null
          phase_ready?: boolean | null
          production_assisted_enabled?: boolean
          production_auto_enabled?: boolean
          rate_limit_per_minute?: number
          real_robot_paused?: boolean
          require_manual_approval?: boolean
          status?: string
          updated_at?: string
          weekly_loss_limit?: number | null
        }
        Update: {
          active_timeframes?: string[]
          alerts_telegram_enabled?: boolean | null
          alerts_whatsapp_enabled?: boolean | null
          binance_mock_mode?: boolean
          collect_frequency_seconds?: number
          daily_loss_limit?: number | null
          default_stop_pct?: number | null
          default_take_pct?: number | null
          id?: number
          max_loss_streak?: number | null
          max_per_asset?: number | null
          max_per_trade?: number | null
          max_portfolio_exposure?: number | null
          min_score_for_real?: number
          mode?: string
          monthly_loss_limit?: number | null
          phase_ready?: boolean | null
          production_assisted_enabled?: boolean
          production_auto_enabled?: boolean
          rate_limit_per_minute?: number
          real_robot_paused?: boolean
          require_manual_approval?: boolean
          status?: string
          updated_at?: string
          weekly_loss_limit?: number | null
        }
        Relationships: []
      }
      seasonal_performance: {
        Row: {
          computed_at: string
          drawdown: number | null
          id: string
          metrics: Json
          net_pnl: number | null
          period: string
          profit_factor: number | null
          trades_count: number
          win_rate: number | null
        }
        Insert: {
          computed_at?: string
          drawdown?: number | null
          id?: string
          metrics?: Json
          net_pnl?: number | null
          period: string
          profit_factor?: number | null
          trades_count?: number
          win_rate?: number | null
        }
        Update: {
          computed_at?: string
          drawdown?: number | null
          id?: string
          metrics?: Json
          net_pnl?: number | null
          period?: string
          profit_factor?: number | null
          trades_count?: number
          win_rate?: number | null
        }
        Relationships: []
      }
      simulated_orders: {
        Row: {
          agents_against: number
          agents_favor: number
          buy_fee: number
          closed_at: string | null
          closed_price: number | null
          created_at: string
          decision_id: string | null
          entry_price: number
          expected_net_profit: number | null
          expected_roi_pct: number | null
          gross_pnl: number | null
          gross_roi_pct: number | null
          id: string
          justification: string | null
          net_pnl: number | null
          net_roi_pct: number | null
          pair: string
          quantity: number
          realized_pnl: number | null
          score: number
          sell_fee: number
          side: string
          status: string
          stop_price: number | null
          target_price: number | null
          total_fees: number
        }
        Insert: {
          agents_against?: number
          agents_favor?: number
          buy_fee?: number
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          decision_id?: string | null
          entry_price: number
          expected_net_profit?: number | null
          expected_roi_pct?: number | null
          gross_pnl?: number | null
          gross_roi_pct?: number | null
          id?: string
          justification?: string | null
          net_pnl?: number | null
          net_roi_pct?: number | null
          pair: string
          quantity: number
          realized_pnl?: number | null
          score?: number
          sell_fee?: number
          side: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
          total_fees?: number
        }
        Update: {
          agents_against?: number
          agents_favor?: number
          buy_fee?: number
          closed_at?: string | null
          closed_price?: number | null
          created_at?: string
          decision_id?: string | null
          entry_price?: number
          expected_net_profit?: number | null
          expected_roi_pct?: number | null
          gross_pnl?: number | null
          gross_roi_pct?: number | null
          id?: string
          justification?: string | null
          net_pnl?: number | null
          net_roi_pct?: number | null
          pair?: string
          quantity?: number
          realized_pnl?: number | null
          score?: number
          sell_fee?: number
          side?: string
          status?: string
          stop_price?: number | null
          target_price?: number | null
          total_fees?: number
        }
        Relationships: [
          {
            foreignKeyName: "simulated_orders_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "committee_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      simulated_positions: {
        Row: {
          avg_price: number
          id: string
          pair: string
          quantity: number
          unrealized_pnl: number
          updated_at: string
        }
        Insert: {
          avg_price?: number
          id?: string
          pair: string
          quantity?: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Update: {
          avg_price?: number
          id?: string
          pair?: string
          quantity?: number
          unrealized_pnl?: number
          updated_at?: string
        }
        Relationships: []
      }
      simulated_wallet: {
        Row: {
          current_balance: number
          equity: number
          id: number
          initial_balance: number
          updated_at: string
        }
        Insert: {
          current_balance?: number
          equity?: number
          id?: number
          initial_balance?: number
          updated_at?: string
        }
        Update: {
          current_balance?: number
          equity?: number
          id?: number
          initial_balance?: number
          updated_at?: string
        }
        Relationships: []
      }
      strategic_memory: {
        Row: {
          asset_id: string | null
          content: string
          created_at: string
          embedding: string | null
          id: string
          kind: string
          metadata: Json
          ref_id: string | null
          ref_table: string | null
          title: string | null
        }
        Insert: {
          asset_id?: string | null
          content: string
          created_at?: string
          embedding?: string | null
          id?: string
          kind: string
          metadata?: Json
          ref_id?: string | null
          ref_table?: string | null
          title?: string | null
        }
        Update: {
          asset_id?: string | null
          content?: string
          created_at?: string
          embedding?: string | null
          id?: string
          kind?: string
          metadata?: Json
          ref_id?: string | null
          ref_table?: string | null
          title?: string | null
        }
        Relationships: []
      }
      strategy_comparisons: {
        Row: {
          baseline_run_id: string | null
          created_at: string
          deltas: Json | null
          id: string
          name: string
          notes: string | null
          run_ids: Json
        }
        Insert: {
          baseline_run_id?: string | null
          created_at?: string
          deltas?: Json | null
          id?: string
          name: string
          notes?: string | null
          run_ids: Json
        }
        Update: {
          baseline_run_id?: string | null
          created_at?: string
          deltas?: Json | null
          id?: string
          name?: string
          notes?: string | null
          run_ids?: Json
        }
        Relationships: [
          {
            foreignKeyName: "strategy_comparisons_baseline_run_id_fkey"
            columns: ["baseline_run_id"]
            isOneToOne: false
            referencedRelation: "backtest_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      strategy_laboratory: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          id: string
          name: string
          status: string
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name: string
          status?: string
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      strategy_simulations: {
        Row: {
          created_at: string
          expected_drawdown: number | null
          expected_pnl: number | null
          expected_winrate: number | null
          id: string
          lab_id: string | null
          notes: string | null
          params: Json
          results: Json
          score: number | null
        }
        Insert: {
          created_at?: string
          expected_drawdown?: number | null
          expected_pnl?: number | null
          expected_winrate?: number | null
          id?: string
          lab_id?: string | null
          notes?: string | null
          params?: Json
          results?: Json
          score?: number | null
        }
        Update: {
          created_at?: string
          expected_drawdown?: number | null
          expected_pnl?: number | null
          expected_winrate?: number | null
          id?: string
          lab_id?: string | null
          notes?: string | null
          params?: Json
          results?: Json
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "strategy_simulations_lab_id_fkey"
            columns: ["lab_id"]
            isOneToOne: false
            referencedRelation: "strategy_laboratory"
            referencedColumns: ["id"]
          },
        ]
      }
      supervisor_reviews: {
        Row: {
          anomalies: Json
          automated_trade_id: string | null
          checks: Json
          created_at: string
          data_quality_score: number | null
          id: string
          justification: string | null
          request_id: string | null
          verdict: string
        }
        Insert: {
          anomalies?: Json
          automated_trade_id?: string | null
          checks?: Json
          created_at?: string
          data_quality_score?: number | null
          id?: string
          justification?: string | null
          request_id?: string | null
          verdict: string
        }
        Update: {
          anomalies?: Json
          automated_trade_id?: string | null
          checks?: Json
          created_at?: string
          data_quality_score?: number | null
          id?: string
          justification?: string | null
          request_id?: string | null
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "supervisor_reviews_automated_trade_id_fkey"
            columns: ["automated_trade_id"]
            isOneToOne: false
            referencedRelation: "automated_trades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisor_reviews_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "real_trade_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      system_logs: {
        Row: {
          created_at: string
          event_type: string
          id: string
          message: string
          severity: string
          source: string
          technical_data: Json | null
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          message: string
          severity?: string
          source: string
          technical_data?: Json | null
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          message?: string
          severity?: string
          source?: string
          technical_data?: Json | null
        }
        Relationships: []
      }
      testnet_orders: {
        Row: {
          asset_id: string | null
          binance_order_id: string | null
          binance_status: string | null
          created_at: string
          filled_at: string | null
          id: string
          pair: string
          pnl: number | null
          price: number | null
          qty: number
          raw_response: Json | null
          session_id: string | null
          side: string
          stop_loss: number | null
          take_profit: number | null
          type: string
        }
        Insert: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          created_at?: string
          filled_at?: string | null
          id?: string
          pair: string
          pnl?: number | null
          price?: number | null
          qty: number
          raw_response?: Json | null
          session_id?: string | null
          side: string
          stop_loss?: number | null
          take_profit?: number | null
          type?: string
        }
        Update: {
          asset_id?: string | null
          binance_order_id?: string | null
          binance_status?: string | null
          created_at?: string
          filled_at?: string | null
          id?: string
          pair?: string
          pnl?: number | null
          price?: number | null
          qty?: number
          raw_response?: Json | null
          session_id?: string | null
          side?: string
          stop_loss?: number | null
          take_profit?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "testnet_orders_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "monitored_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "testnet_orders_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "trading_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      trade_explanations: {
        Row: {
          content: string
          created_at: string
          generated_by: string | null
          id: string
          position_id: string | null
          request_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          generated_by?: string | null
          id?: string
          position_id?: string | null
          request_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          generated_by?: string | null
          id?: string
          position_id?: string | null
          request_id?: string | null
        }
        Relationships: []
      }
      trading_sessions: {
        Row: {
          created_at: string
          current_balance: number
          id: string
          initial_balance: number
          meta: Json | null
          mode: string
          reason: string | null
          started_at: string
          status: string
          stopped_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          meta?: Json | null
          mode: string
          reason?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_balance?: number
          id?: string
          initial_balance?: number
          meta?: Json | null
          mode?: string
          reason?: string | null
          started_at?: string
          status?: string
          stopped_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      weekly_reports: {
        Row: {
          agent_ranking: Json
          content: string | null
          created_at: string
          id: string
          performance: Json
          problem_assets: Json
          suggested_adjustments: string | null
          top_assets: Json
          week_end: string
          week_start: string
        }
        Insert: {
          agent_ranking?: Json
          content?: string | null
          created_at?: string
          id?: string
          performance?: Json
          problem_assets?: Json
          suggested_adjustments?: string | null
          top_assets?: Json
          week_end: string
          week_start: string
        }
        Update: {
          agent_ranking?: Json
          content?: string | null
          created_at?: string
          id?: string
          performance?: Json
          problem_assets?: Json
          suggested_adjustments?: string | null
          top_assets?: Json
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
    }
    Views: {
      b3_livro_a_avaliar: {
        Row: {
          aplicada_em: string | null
          ativo: string | null
          autor: string | null
          avaliar_em: string | null
          dias_ate: number | null
          escopo: string | null
          evidencia: string | null
          modalidade: string | null
          modo: string | null
          o_que: string | null
          valor_antes: string | null
          valor_depois: string | null
        }
        Insert: {
          aplicada_em?: string | null
          ativo?: never
          autor?: string | null
          avaliar_em?: string | null
          dias_ate?: never
          escopo?: string | null
          evidencia?: string | null
          modalidade?: never
          modo?: never
          o_que?: string | null
          valor_antes?: string | null
          valor_depois?: string | null
        }
        Update: {
          aplicada_em?: string | null
          ativo?: never
          autor?: string | null
          avaliar_em?: string | null
          dias_ate?: never
          escopo?: string | null
          evidencia?: string | null
          modalidade?: never
          modo?: never
          o_que?: string | null
          valor_antes?: string | null
          valor_depois?: string | null
        }
        Relationships: []
      }
      v_b3_cat_robos: {
        Row: {
          apelido: string | null
          be_arma: number | null
          conf_pct: number | null
          conf_real: boolean | null
          conf_seg: number | null
          conf_sim: boolean | null
          config_alterada_em: string | null
          contratos: number | null
          daily_gain_target_brl: number | null
          daily_loss_limit_brl: number | null
          daily_stop_mult: number | null
          entry_cutoff_time: string | null
          entry_style: string | null
          force_close_time: string | null
          gain_pts: number | null
          grupo: string | null
          limites_proporcionais: boolean | null
          min_approve_votes: number | null
          min_confidence: number | null
          min_score: number | null
          mode: string | null
          no_real: boolean | null
          ordem: number | null
          peak_giveback_pct: number | null
          peak_lock_min_profit_brl: number | null
          risco_retorno: number | null
          run_id: string | null
          run_status: string | null
          stop_pts: number | null
          symbol: string | null
          trading_start_time: string | null
          trail_arma: number | null
          trail_arma_pct_stop: number | null
          trail_devolve: number | null
          trailing_mode: string | null
          variant: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      b3_alarme_cotacao_parada: {
        Args: { p_minutos?: number }
        Returns: number
      }
      b3_arquivar_catalogo: { Args: never; Returns: undefined }
      b3_atualizar_curadoria: {
        Args: { p_date?: string }
        Returns: {
          medalhas_novas: number
          medalhas_revogadas: number
        }[]
      }
      b3_avaliar_saude_pregao: {
        Args: { p_date?: string }
        Returns: {
          out_data: string
          out_limpo: boolean
          out_motivo: string
        }[]
      }
      b3_calcular_paridade: { Args: { p_desde?: string }; Returns: number }
      b3_calcular_score_dia: { Args: { p_date?: string }; Returns: number }
      b3_calibrar_limites: {
        Args: { p_dias?: number; p_semana?: string }
        Returns: number
      }
      b3_cat_espelho: {
        Args: { p_fim: string; p_ini: string }
        Returns: {
          apelido: string
          dia: string
          disjuntor: string
          mode: string
          paridade_pct: number
          real_entradas: number
          real_resultado: number
          sim_brl_com_freio: number
          sim_livres: number
          sim_ordens: number
          travou_as: string
        }[]
      }
      b3_cat_resultado: {
        Args: { p_fim: string; p_ini: string }
        Returns: {
          acerto_pct: number
          apelido: string
          barradas: number
          brl_com_freio: number
          brl_sem_freio: number
          contratos: number
          efeito_freio: number
          grupo: string
          mode: string
          no_alvo: number
          no_stop: number
          no_trailing: number
          ordens: number
          ordens_livres: number
          pct_stop: number
          por_contrato_com_freio: number
          pregoes: number
          run_id: string
          symbol: string
          variant: string
        }[]
      }
      b3_catalogo: { Args: { p_fim?: string; p_ini?: string }; Returns: string }
      b3_catalogo_completo: {
        Args: { p_fim?: string; p_ini?: string }
        Returns: string
      }
      b3_catalogo_glossario: { Args: never; Returns: string }
      b3_catalogo_real: { Args: never; Returns: string }
      b3_catalogo_win: {
        Args: { p_fim: string; p_ini: string }
        Returns: string
      }
      b3_cor_do_robo: {
        Args: {
          p_caiu_em: string
          p_medal: boolean
          p_neg: number
          p_rank: number
          p_streak: number
        }
        Returns: string
      }
      b3_cores_dos_robos: {
        Args: never
        Returns: {
          caiu_de_verde_em: string
          cor: string
          medal: boolean
          mode: string
          neg_streak: number
          rank_day: number
          streak_days: number
          symbol: string
          variant: string
        }[]
      }
      b3_csv_num: { Args: { v: number }; Returns: string }
      b3_csv_txt: { Args: { t: string }; Returns: string }
      b3_derivar_teto_grupo: {
        Args: { p_symbol: string; p_variant: string }
        Returns: number
      }
      b3_detectar_ordens_fantasma: {
        Args: never
        Returns: {
          alem_do_stop: number
          entrada: number
          lado: string
          minutos_aberta: number
          modo: string
          nivel_stop: number
          preco_atual: number
          symbol: string
          variant: string
        }[]
      }
      b3_diagnosticar_dia: { Args: { p_date: string }; Returns: number }
      b3_disparar_exportacao: { Args: never; Returns: string }
      b3_disparar_guardiao: { Args: never; Returns: string }
      b3_disparar_tique: { Args: never; Returns: string }
      b3_export_csv_bloqueios: {
        Args: { p_ativo: string; p_date: string }
        Returns: {
          csv: string
          linhas: number
        }[]
      }
      b3_export_csv_decisoes: {
        Args: { p_date: string }
        Returns: {
          csv: string
          linhas: number
        }[]
      }
      b3_export_csv_dossie_ordens: {
        Args: { p_date: string }
        Returns: {
          csv: string
          linhas: number
        }[]
      }
      b3_export_csv_dossie_votos: {
        Args: { p_date: string }
        Returns: {
          csv: string
          linhas: number
        }[]
      }
      b3_export_dias: {
        Args: { p_desde?: string }
        Returns: {
          ativos: string[]
          dia: string
        }[]
      }
      b3_export_raiz: { Args: { p: string }; Returns: string }
      b3_gravar_cenario_horario: {
        Args: { p_dia?: string; p_hora?: number }
        Returns: number
      }
      b3_m1_candles: {
        Args: { p_limit?: number; p_symbol: string; p_user_id: string }
        Returns: {
          candle_close: number
          candle_high: number
          candle_low: number
          candle_open: number
          minute_ts: string
          ticks: number
          volume: number
        }[]
      }
      b3_magic: {
        Args: { p_mode: string; p_symbol: string; p_variant: string }
        Returns: number
      }
      b3_magic_valido: { Args: { p_magic: number }; Returns: boolean }
      b3_marcar_dias_com_intervencao: {
        Args: { p_date?: string }
        Returns: number
      }
      b3_materializar_m1: { Args: { p_date?: string }; Returns: number }
      b3_motor_noite: { Args: { p_ligar: boolean }; Returns: string }
      b3_prd_atualizar_parametros: {
        Args: {
          p_max_daily_loss_brl: number
          p_max_daily_loss_mult: number
          p_max_qty: number
          p_mode: string
          p_origem: string
          p_sessao_id: string
          p_symbol: string
          p_user_id: string
          p_variant: string
        }
        Returns: {
          enabled: boolean
          id: string
          magic_number: number
          max_daily_loss_brl: number
          max_daily_loss_mult: number
          max_qty: number
          mode: string
          symbol: string
          variant: string
        }[]
      }
      b3_ranking_medalhados: {
        Args: { p_criterio?: string }
        Returns: {
          capital: number
          mode: string
          posicao: number
          resultado: number
          retorno_pct: number
          symbol: string
          variant: string
        }[]
      }
      b3_resultado_combinacao:
        | {
            Args: { p_ate: string; p_de: string; p_group?: string }
            Returns: {
              chave: string
              hit_rate: number
              media_op: number
              melhor_dia: number
              mode: string
              ops: number
              ops_pos: number
              pct_pregoes_pos: number
              pior_dia: number
              pregoes: number
              pregoes_pos: number
              resultado_brl: number
              score_medio: number
              symbol: string
              variant: string
            }[]
          }
        | {
            Args: {
              p_ate: string
              p_de: string
              p_group?: string
              p_modes?: string[]
              p_symbols?: string[]
              p_variants?: string[]
            }
            Returns: {
              chave: string
              hit_rate: number
              media_op: number
              melhor_dia: number
              mode: string
              ops: number
              ops_pos: number
              pct_pregoes_pos: number
              pior_dia: number
              pregoes: number
              pregoes_pos: number
              resultado_brl: number
              score_medio: number
              symbol: string
              variant: string
            }[]
          }
      b3_retencao_diaria: {
        Args: { p_lote?: number; p_max_lotes?: number }
        Returns: {
          apagadas: number
          atingiu_teto: boolean
          duracao: string
          erro: string
          tabela: string
        }[]
      }
      b3_rotular_regime: { Args: { p_date?: string }; Returns: number }
      b3_simular_conta: {
        Args: {
          p_contratos?: number
          p_fim: string
          p_ini: string
          p_meta_pct: number
          p_robos: string[]
          p_symbol?: string
          p_teto_pct: number
        }
        Returns: {
          base_brl: number
          brl_com_disjuntor: number
          brl_sem_disjuntor: number
          dias: number
          dias_sem_trava: number
          dias_trava_lucro: number
          dias_trava_perda: number
          diferenca: number
          melhor_dia: number
          ordens_admitidas: number
          ordens_cortadas: number
          ordens_total: number
          pior_dia: number
        }[]
      }
      b3_simular_disjuntor: {
        Args: {
          p_fim: string
          p_ini: string
          p_meta_pct: number
          p_symbol?: string
          p_teto_pct: number
        }
        Returns: {
          apelido: string
          base_brl: number
          brl_com_disjuntor: number
          brl_sem_disjuntor: number
          cortadas: number
          dias: number
          dias_trava_lucro: number
          dias_trava_perda: number
          diferenca: number
          mode: string
          ordens_com: number
          ordens_sem: number
          variant: string
        }[]
      }
      b3_simular_pico: {
        Args: {
          p_contratos?: number
          p_fim: string
          p_giveback: number
          p_ini: string
          p_pico_min: number
          p_robos: string[]
          p_symbol?: string
          p_teto_pct: number
        }
        Returns: {
          base_brl: number
          dias: number
          dias_livres: number
          melhor_dia: number
          ordens_admitidas: number
          ordens_cortadas: number
          pior_dia: number
          resultado: number
          trav_perda: number
          trav_pico: number
        }[]
      }
      b3_vigiar_autorizacoes_reais: { Args: never; Returns: number }
      b3_vigiar_tique: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_owner: { Args: never; Returns: boolean }
      match_expert_chunks: {
        Args: {
          p_expert_id: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          content: string
          id: string
          metadata: Json
          similarity: number
        }[]
      }
      match_strategic_memory: {
        Args: {
          p_asset_id?: string
          p_kind?: string
          p_match_count?: number
          p_query_embedding: string
        }
        Returns: {
          asset_id: string
          content: string
          created_at: string
          id: string
          kind: string
          metadata: Json
          similarity: number
          title: string
        }[]
      }
    }
    Enums: {
      app_role: "owner"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["owner"],
    },
  },
} as const
