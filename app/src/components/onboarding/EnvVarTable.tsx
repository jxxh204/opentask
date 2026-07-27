import { useSetupStore } from '../../store/useSetupStore'
import EnvVarRow from './EnvVarRow'
import styles from './EnvVarTable.module.css'

export default function EnvVarTable() {
	const env = useSetupStore((s) => s.env)
	const addEnvVar = useSetupStore((s) => s.addEnvVar)
	const updateEnvVar = useSetupStore((s) => s.updateEnvVar)
	const removeEnvVar = useSetupStore((s) => s.removeEnvVar)

	return (
		<div className={styles.wrap}>
			<div className={styles.headRow}>
				<span className={styles.headCell}>KEY</span>
				<span className={styles.headCell}>VALUE</span>
				<span />
			</div>
			{env.map((row) => (
				<EnvVarRow key={row.id} row={row} onUpdate={(patch) => updateEnvVar(row.id, patch)} onRemove={() => removeEnvVar(row.id)} />
			))}
			<div className={styles.footer}>
				<button className={styles.addBtn} onClick={addEnvVar}>
					+ 변수 추가
				</button>
				<div style={{ flex: 1 }} />
				<span className={`m ${styles.countText}`}>{env.length}개 변수</span>
			</div>
		</div>
	)
}
