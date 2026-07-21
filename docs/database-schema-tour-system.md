# Database Schema Changes for Tour System

## Overview
This document describes the database schema changes required to support the tour system disable/enable functionality and onboarding status tracking.

## New Table: `tour_system_settings`

Stores global and tenant-specific tour system configuration.

```sql
CREATE TABLE tour_system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled BOOLEAN NOT NULL DEFAULT false,
  disabled_by VARCHAR(255),
  disabled_at TIMESTAMP WITH TIME ZONE,
  environment VARCHAR(50) NOT NULL DEFAULT 'production',
  tenant_scope VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tour_system_settings_user FOREIGN KEY (disabled_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_tour_system_settings_tenant ON tour_system_settings(tenant_scope);
CREATE INDEX idx_tour_system_settings_environment ON tour_system_settings(environment);
```

### Columns:
- `id`: Unique identifier for the settings record
- `enabled`: Whether tours are enabled (false = disabled globally)
- `disabled_by`: User ID who disabled the system (audit trail)
- `disabled_at`: Timestamp when tours were disabled
- `environment`: Environment scope (development, staging, production)
- `tenant_scope`: Optional tenant ID for multi-tenant overrides
- `created_at`: Record creation timestamp
- `updated_at`: Last update timestamp

## Existing Table: `users` - Add `onboarding_status`

Add a new column to track user onboarding status.

```sql
ALTER TABLE users ADD COLUMN onboarding_status VARCHAR(50) DEFAULT 'not_started';

-- Add check constraint for valid values
ALTER TABLE users ADD CONSTRAINT chk_onboarding_status 
  CHECK (onboarding_status IN ('suspended', 'completed', 'not_started', 'in_progress'));

-- Create index for filtering
CREATE INDEX idx_users_onboarding_status ON users(onboarding_status);
```

### Possible Values:
- `suspended`: Onboarding temporarily suspended (system-wide disable)
- `completed`: User has completed onboarding
- `not_started`: User has not started onboarding
- `in_progress`: User is currently in onboarding

## Migration Notes

### Migration 1: Create tour_system_settings table
```sql
-- Run this migration to create the new table
-- This should be executed before the tour system is deployed
```

### Migration 2: Add onboarding_status to users table
```sql
-- Run this migration to add the onboarding status column
-- Existing users will default to 'not_started'
```

## API Endpoints (Future Implementation)

### GET /api/tour-system/settings
Retrieve current tour system settings for the current tenant/environment.

### PUT /api/tour-system/settings
Update tour system settings (requires Super Admin, Platform Owner, or Developer role).

### GET /api/users/:id/onboarding-status
Get onboarding status for a specific user.

### PUT /api/users/:id/onboarding-status
Update onboarding status for a specific user.

## Security Considerations

- Only Super Admin, Platform Owner, and Developer roles can modify tour_system_settings
- onboarding_status updates should be audited
- Tenant-scoped settings should respect multi-tenant isolation
- Environment-specific settings should prevent accidental production changes from development

## Rollback Plan

If issues arise, the following rollback steps can be taken:

1. Set `tour_system_settings.enabled = true` for all environments
2. Remove the feature flag override from localStorage
3. Restart the application to clear cached state

## Performance Impact

- Minimal: New table is small and rarely accessed
- Index on tenant_scope ensures fast lookups in multi-tenant scenarios
- onboarding_status column is indexed for efficient filtering
