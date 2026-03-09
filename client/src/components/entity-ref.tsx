import { useLocation } from "wouter";
import { Eye, FileText, HeartPulse, UserCheck, Truck, Building2, Globe, Users } from "lucide-react";

interface EntityRefProps {
  id: number;
  label?: string;
  publicId?: string;
  showIcon?: boolean;
  className?: string;
  size?: "sm" | "md";
}

const LINK_CLASS = "inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 hover:underline cursor-pointer font-medium";

function EntityLink({ id, route, label, publicId, showIcon = true, className = "", size = "sm", icon: Icon, entityName, testPrefix }: EntityRefProps & { route: string; icon: any; entityName: string; testPrefix: string }) {
  const [, navigate] = useLocation();
  if (!id) return <span className="text-muted-foreground text-xs">—</span>;
  const display = label || publicId || `#${id}`;
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); navigate(route); }}
      className={`${LINK_CLASS} ${textSize} ${className}`}
      title={`View ${entityName} ${display}`}
      data-testid={`link-${testPrefix}-${id}`}
    >
      {showIcon && <Icon className="w-3 h-3 flex-shrink-0" />}
      <span>{display}</span>
    </button>
  );
}

export function PatientRef(props: EntityRefProps) {
  return <EntityLink {...props} route={`/patients/${props.id}`} icon={HeartPulse} entityName="Patient" testPrefix="patient" />;
}

export function DriverRef(props: EntityRefProps) {
  return <EntityLink {...props} route={`/drivers/${props.id}`} icon={UserCheck} entityName="Driver" testPrefix="driver" />;
}

export function VehicleRef(props: EntityRefProps) {
  return <EntityLink {...props} route={`/vehicles/${props.id}`} icon={Truck} entityName="Vehicle" testPrefix="vehicle" />;
}

export function ClinicRef(props: EntityRefProps) {
  return <EntityLink {...props} route={`/clinics/${props.id}`} icon={Building2} entityName="Clinic" testPrefix="clinic" />;
}

export function CompanyRef(props: EntityRefProps) {
  return <EntityLink {...props} route={`/companies?highlight=${props.id}`} icon={Globe} entityName="Company" testPrefix="company" />;
}
