export function canDelete(user: { role: string }) { return user.role === 'admin'; }
