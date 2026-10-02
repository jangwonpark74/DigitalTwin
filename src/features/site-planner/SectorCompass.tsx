type Sector = { id: string; azimuthDeg: number };
export default function SectorCompass({ sectors, selectedId }: { sectors: Sector[]; selectedId: string }) {
  const point = (angle: number, radius = 76) => [110 + Math.sin(angle * Math.PI / 180) * radius, 110 - Math.cos(angle * Math.PI / 180) * radius];
  return <figure className="sp-sector-compass"><svg viewBox="0 0 220 220" role="img" aria-label={`Sector bearings; selected ${selectedId}`}>
    <circle cx="110" cy="110" r="84" fill="#f7faf6" stroke="#e1e8dd" />
    <circle cx="110" cy="110" r="45" fill="none" stroke="#e1e8dd" strokeDasharray="3 4" />
    <path d="M110 23V197 M23 110H197" stroke="#dce5d8" strokeWidth="1" />
    {sectors.map((sector, index) => {
      const selected = sector.id === selectedId, a = point(sector.azimuthDeg - 27), b = point(sector.azimuthDeg + 27), label = point(sector.azimuthDeg, 62);
      return <g key={sector.id}><path d={`M110 110 L${a} A76 76 0 0 1 ${b} Z`} fill={selected ? '#d4e8cf' : '#e6ece2'}
        stroke={selected ? '#668d55' : '#bdceb6'} strokeWidth={selected ? 1.8 : 1} />
        <text x={label[0]} y={label[1]} dy="4" textAnchor="middle" fill={selected ? '#325532' : '#809077'} fontSize="11" fontWeight="600">0{index + 1}</text></g>;
    })}
    <circle cx="110" cy="110" r="9" fill="#41664a" stroke="#fff" strokeWidth="3" />
    <g fill="#8d9b87" fontSize="10" textAnchor="middle"><text x="110" y="14">N</text><text x="208" y="114">E</text><text x="110" y="214">S</text><text x="12" y="114">W</text></g>
  </svg><figcaption>Sector orientation</figcaption></figure>;
}
