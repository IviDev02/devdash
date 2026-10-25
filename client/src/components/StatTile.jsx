import Icon from "./Icon.jsx";

export default function StatTile({ icon, label, value, hint, tone = "accent" }) {
  return (
    <div className={`tile tone-${tone}`}>
      <div className="tile-head">
        <span className="tile-icon">
          <Icon name={icon} size={15} />
        </span>
        <span className="tile-label">{label}</span>
      </div>
      <div className="tile-value">{value}</div>
      {hint && <div className="tile-hint">{hint}</div>}
    </div>
  );
}
