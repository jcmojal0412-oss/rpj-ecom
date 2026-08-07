'use client';
import EmployeeProfileClient from '@/components/employees/EmployeeProfileClient';

export default function EmployeeProfilePage({ params }: { params: { id: string } }) {
  return <EmployeeProfileClient employeeId={Number(params.id)} />;
}
